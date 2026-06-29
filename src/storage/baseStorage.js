const crypto = require("node:crypto");
const { pool } = require("../db/pool");
const { getTransactionClient } = require("../db/transactionContext");
const { getOrCompute } = require("../services/cacheService");
const { selectQuery, deleteQuery, insertQuery, updateQuery, qualify } = require("../services/queryService");
const { loadMergedFieldSpecs, loadMergedCoreFieldSpecs } = require("../fields/fieldManifest");
const {
  buildEntityFieldSpecsFromManifest,
  addSingleValueFieldJoins,
  singleValueFieldsFromRow,
  loadMultiValueFields,
  saveFieldValuesForEntity,
  resolvePropertyPath,
} = require("../fields/fieldStorage");

/**
 * Base class for GenRPG storage modules.
 *
 * Entity base tables hold only fundamentals: guid, instance_guid (when scoped),
 * create_datetime, update_datetime. All other data lives in manifest field tables
 * ({@link BaseStorage#getFieldManifestSpecs}) joined at load time.
 */
class BaseStorage {
  /** @type {string | undefined} */
  static schema;

  /** @type {string | undefined} */
  static table;

  /**
   * Entity class this storage serves.
   * @type {typeof import("../entities/baseEntity").BaseEntity | undefined}
   */
  static Entity;

  /**
   * When false, storage is global (not keyed by instance_guid). {@link BaseStorage.forInstance}
   * returns a storage instance with no instance binding.
   */
  static get instanceScoped() {
    return true;
  }

  constructor(instance = null) {
    if (this.constructor.instanceScoped && !instance?.guid) {
      throw new Error("instance is required for storage modules");
    }
    this.instance = instance;
  }

  /** @returns {string | null} */
  get instanceGuid() {
    return this.instance?.guid ?? null;
  }

  /** @returns {string[]} Package machine names for this instance binding. */
  get packageNames() {
    return this.instance?.packageNames ?? [];
  }

  static forInstance(instance) {
    if (!this.instanceScoped) {
      return new this(null);
    }

    if (!instance?.guid) {
      throw new Error("instance guid is required for storage modules");
    }

    return new this(instance);
  }

  /** Global (non-instance) storage binding. Only valid when {@link BaseStorage.instanceScoped} is false. */
  static global() {
    if (this.instanceScoped) {
      throw new Error(`${this.name} is instance-scoped`);
    }
    return new this(null);
  }

  get pool() {
    return pool;
  }

  /** @returns {typeof import("../entities/baseEntity").BaseEntity} */
  get entityClass() {
    const Entity = this.constructor.Entity;
    if (!Entity) {
      throw new Error(`${this.constructor.name} must define static Entity`);
    }
    return Entity;
  }

  async getFieldManifestSpecs() {
    const { entityClass, instanceGuid } = this;
    if (!entityClass.key) {
      return {};
    }

    return getOrCompute(
      `entity.field_manifest:${entityClass.key}`,
      async () => {
        const merged = await loadMergedFieldSpecs();
        return merged[entityClass.key] || {};
      },
      { instanceGuid, memoryOnly: true },
    );
  }

  async getFieldSpecs() {
    const { entityClass, instanceGuid } = this;
    if (!entityClass.key) {
      return {};
    }

    return getOrCompute(
      `entity.fields:${entityClass.key}`,
      async () => {
        const merged = await loadMergedFieldSpecs();
        const manifest = merged[entityClass.key] || {};
        return buildEntityFieldSpecsFromManifest(manifest);
      },
      { instanceGuid, memoryOnly: true },
    );
  }

  async getCoreFieldSpecs() {
    const { entityClass, instanceGuid } = this;
    if (!entityClass.key) {
      return {};
    }

    return getOrCompute(
      `entity.core_fields:${entityClass.key}`,
      async () => {
        const merged = await loadMergedCoreFieldSpecs();
        return merged[entityClass.key] || {};
      },
      { instanceGuid, memoryOnly: true },
    );
  }

  /** Column names selected from the entity base table. */
  async getCoreEntityFields() {
    const columns = ["guid", "create_datetime", "update_datetime"];

    if (this.constructor.instanceScoped) {
      columns.push("instance_guid");
    }

    for (const spec of Object.values(await this.getCoreFieldSpecs())) {
      columns.push(spec.column);
    }

    return columns;
  }

  /** Base-table properties mapped when hydrating from a SQL row. */
  async getCoreFieldEntries() {
    const entries = [
      { property: "createDatetime", column: "create_datetime" },
      { property: "updateDatetime", column: "update_datetime" },
    ];

    for (const [property, spec] of Object.entries(await this.getCoreFieldSpecs())) {
      entries.push({ property, column: spec.column });
    }

    return entries;
  }

  async coreOptionsFromRow(row) {
    const options = { guid: row.guid };
    if (this.constructor.instanceScoped) {
      options.instanceGuid = row.instance_guid;
    }

    for (const { property, column } of await this.getCoreFieldEntries()) {
      if (column in row) {
        options[property] = row[column];
      }
    }

    return options;
  }

  /**
   * INSERT or UPDATE the entity base row (fundamentals only).
   * @returns {Promise<object | null>}
   */
  async saveCoreRow(entity) {
    const { schema, table } = this.constructor;
    const coreFieldSpecs = await this.getCoreFieldSpecs();
    const coreFields = Object.entries(coreFieldSpecs);
    const updatableCoreFields = coreFields.filter(([, spec]) => !spec.createOnly);

    if (entity.isNew) {
      const insertColumns = ["guid"];
      const insertValues = [entity.guid];
      if (this.constructor.instanceScoped) {
        insertColumns.push("instance_guid");
        insertValues.push(entity.instanceGuid);
      }

      for (const [property, spec] of coreFields) {
        insertColumns.push(spec.column);
        insertValues.push(entity[property]);
      }

      const insert = insertQuery()
        .into(schema, table)
        .values(insertColumns, insertValues);

      await this.query(insert.toString(), insert.params);
      entity.isNew = false;
      return entity;
    }

    if (!updatableCoreFields.length) {
      return (await this.exists(entity.guid)) ? entity : null;
    }

    const t = this.tableAlias;
    const query = updateQuery()
      .from(schema, table, t)
      .set(
        updatableCoreFields.map(([, spec]) => spec.column),
        updatableCoreFields.map(([property]) => entity[property]),
      )
      .whereColumn(t, "guid", entity.guid);

    if (this.instanceGuid) {
      query.whereColumn(t, "instance_guid", this.instanceGuid);
    }

    query.returning(t, "guid");

    const result = await this.query(query.toString(), query.params);
    return result.rows.length ? entity : null;
  }

  /**
   * Persist field-table values, reload the entity, and copy hydrated values back.
   */
  async reloadEntityAfterSave(entity, { skipEvents = true } = {}) {
    const manifestSpecs = await this.getFieldManifestSpecs();
    await saveFieldValuesForEntity(
      (text, params) => this.query(text, params),
      entity.guid,
      entity,
      manifestSpecs,
    );

    const reloaded = await this.load(entity.guid, { skipEvents });
    if (!reloaded) {
      return entity;
    }

    for (const { property } of await this.getCoreFieldEntries()) {
      entity[property] = reloaded[property];
    }
    for (const key of Object.keys(reloaded.fieldSpecs)) {
      if (key in reloaded) {
        entity[key] = reloaded[key];
      }
    }
    return entity;
  }

  /** Alias for the core table in SELECT queries built by {@link BaseStorage.buildSelect}. */
  get tableAlias() {
    return "t";
  }

  async buildSelect() {
    const { schema, table } = this.constructor;
    const { tableAlias } = this;
    const manifestSpecs = await this.getFieldManifestSpecs();

    const query = selectQuery()
      .from(schema, table, tableAlias)
      .addFields(tableAlias, await this.getCoreEntityFields());

    // We only add single-value fields, multi-value fields are added later with follow-up queries
    addSingleValueFieldJoins(query, tableAlias, manifestSpecs);

    return query;
  }

  async rowsToEntities(rows) {
    if (!rows.length) {
      return [];
    }

    const manifestSpecs = await this.getFieldManifestSpecs();
    const entityGuids = rows.map((row) => row.guid);
    const multiValueByEntity = await loadMultiValueFields(
      (text, params) => this.query(text, params),
      entityGuids,
      manifestSpecs,
    );

    return Promise.all(
      rows.map((row) => this.toEntity(row, multiValueByEntity[row.guid] || {})),
    );
  }

  static newGuid() {
    return crypto.randomUUID();
  }

  newGuid() {
    return BaseStorage.newGuid();
  }

  /**
   * Run SQL on the active transaction client or the pool.
   */
  async query(text, params = []) {
    const executor = getTransactionClient() || this.pool;
    return executor.query(text, params);
  }

  /**
   * List entities using {@link BaseStorage#buildListQuery}, optional instance and property
   * filters, and ordering. Override in subclasses for non-standard queries or to
   * supply default `orderBy` / filter validation.
   *
   * Do not dispatch get events — {@link BaseStorage.list} wraps this and runs
   * preGet/postGet for callers.
   *
   * @param {object} [options]
   * @param {{ property?: string, field?: string, order?: "ASC"|"DESC", nulls?: "FIRST"|"LAST", expression?: string }[]} [options.orderBy]
   * @param {Record<string, unknown>} [options] additional keys are property filters (camelCase);
   *   skipped when `undefined`, `null`, or `""`
   */
  async listEntities(options = {}) {
    const query = await this.buildListQuery(options);
    const result = await this.query(query.toString(), query.params);
    return this.rowsToEntities(result.rows);
  }

  /**
   * Count entities matching {@link BaseStorage#buildListQuery} filters without hydrating rows.
   *
   * @param {object} [options] same filter keys as {@link BaseStorage#listEntities}; `orderBy` is ignored
   * @returns {Promise<number>}
   */
  async countEntities(options = {}) {
    const query = await this.buildListQuery({ ...options, countOnly: true });
    const result = await this.query(query.toString(), query.params);
    return Number(result.rows[0]?.count ?? 0);
  }

  /**
   * Build a SELECT for {@link BaseStorage#listEntities} / {@link BaseStorage#countEntities}.
   *
   * @param {object} [options]
   * @param {boolean} [options.countOnly] when true, SELECT COUNT(DISTINCT guid) only
   * @param {{ property?: string, field?: string, order?: "ASC"|"DESC", nulls?: "FIRST"|"LAST", expression?: string }[]} [options.orderBy]
   * @param {Record<string, unknown>} [options] additional keys are property filters (camelCase);
   *   skipped when `undefined`, `null`, or `""`
   */
  async buildListQuery({ orderBy = [], countOnly = false, ...filters } = {}) {
    const { schema, table } = this.constructor;
    const t = this.tableAlias;
    const manifestSpecs = await this.getFieldManifestSpecs();
    const coreFieldsByProperty = Object.fromEntries(
      (await this.getCoreFieldEntries()).map(({ property, column }) => [property, { column }]),
    );

    const activeFilters = Object.entries(filters).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    );
    const filterProperties = new Set(
      activeFilters.map(([key]) => key.split(".")[0]),
    );

    const query = selectQuery().from(schema, table, t);

    if (countOnly) {
      query.addExpression(`COUNT(DISTINCT ${qualify(t, "guid")})`, "count");
      addSingleValueFieldJoins(query, t, manifestSpecs, {
        onlyProperties: filterProperties,
        selectFields: false,
      });
    } else {
      query.addFields(t, await this.getCoreEntityFields());
      addSingleValueFieldJoins(query, t, manifestSpecs);
    }

    if (this.instanceGuid) {
      query.whereColumn(t, "instance_guid", this.instanceGuid);
    }

    for (const [key, value] of activeFilters) {
      const target = resolvePropertyPath(key, manifestSpecs, coreFieldsByProperty);
      if (target.coreColumn) {
        query.whereColumn(t, target.coreColumn, value);
      } else {
        query.whereColumn(target.tableAlias, target.column, value);
      }
    }

    if (!countOnly && orderBy.length) {
      for (const entry of orderBy) {
        const direction = entry.order ?? "ASC";
        const nullsOrdering = entry.nulls ? `NULLS ${entry.nulls.toUpperCase()}` : null;

        if (entry.property) {
          const target = resolvePropertyPath(entry.property, manifestSpecs, coreFieldsByProperty);
          if (target.coreColumn) {
            query.orderBy(t, target.coreColumn, direction, nullsOrdering);
          } else {
            query.orderBy(target.tableAlias, target.column, direction, nullsOrdering);
          }
        } else if (entry.expression) {
          query.orderBy(null, entry.expression, direction, nullsOrdering);
        } else if (entry.field) {
          query.orderBy(t, entry.field, direction, nullsOrdering);
        }
      }
    }

    return query;
  }

  /**
   * Load entities for the given guids. Called only with a non-empty array from {@link BaseStorage.load}.
   *
   * Default implementation uses {@link BaseStorage.buildSelect}, filters by guid (and
   * instance_guid when instance-scoped), and maps rows via {@link BaseStorage.toEntity}.
   * Override for non-standard queries. Do not dispatch get events —
   * {@link BaseStorage.load} wraps this and dispatches preGet/postGet for callers.
   *
   * @param {string[]} entityGuids non-empty
   */
  async loadEntity(entityGuids) {
    const query = await this.buildSelect();
    const t = this.tableAlias;

    query.whereColumn(t, "guid", entityGuids);
    if (this.instanceGuid) {
      query.whereColumn(t, "instance_guid", this.instanceGuid);
    }

    const result = await this.query(query.toString(), query.params);
    return this.rowsToEntities(result.rows);
  }

  async toEntity(row, multiValueFields = {}) {
    const [manifestSpecs, fieldSpecs, coreFieldSpecs] = await Promise.all([
      this.getFieldManifestSpecs(),
      this.getFieldSpecs(),
      this.getCoreFieldSpecs(),
    ]);

    return new this.entityClass({
      ...(await this.coreOptionsFromRow(row)),
      storage: this,
      fieldSpecs,
      coreFieldSpecs,
      ...singleValueFieldsFromRow(row, manifestSpecs),
      ...multiValueFields,
    });
  }

  /**
   * Dispatch preGet/postGet lifecycle events on loaded entities.
   * Used by {@link BaseStorage.list} and {@link BaseStorage.load}; rarely called directly.
   */
  async dispatchGetEvents(entities, { skipEvents = false } = {}) {
    if (skipEvents || !this.constructor.Entity) {
      return entities;
    }

    const Entity = this.entityClass;
    if (!entities.length || (!Entity.events?.preGet && !Entity.events?.postGet)) {
      return entities;
    }

    const { instance } = this;
    const pre = await entities[0].dispatchEvent(
      "preGet",
      { entities, instance },
    );
    const preEntities = pre?.entities ?? entities;

    const post = await entities[0].dispatchEvent(
      "postGet",
      { entities: preEntities, instance },
    );

    return post?.entities ?? preEntities;
  }

  /**
   * List entities for the bound instance, with get lifecycle events when configured.
   *
   * Extra options (e.g. `{ characterGuid }`) are passed through to `listEntities()`.
   *
   * @param {{ skipEvents?: boolean, [key: string]: unknown }} [options]
   */
  async list({ skipEvents = false, ...listEntityOptions } = {}) {
    const entities = await this.listEntities(listEntityOptions);
    return this.dispatchGetEvents(entities, { skipEvents });
  }

  /**
   * Load one entity by guid, or multiple when `entityGuidOrGuids` is an array.
   * Single guid → entity or `null`. Guid array → entity array (missing guids omitted).
   *
   * @param {string | string[]} entityGuidOrGuids
   * @param {{ skipEvents?: boolean }} [options]
   */
  async load(entityGuidOrGuids, { skipEvents = false } = {}) {
    const multiple = Array.isArray(entityGuidOrGuids);
    const guids = multiple ? entityGuidOrGuids : [entityGuidOrGuids];
    if (!guids.length) {
      return multiple ? [] : null;
    }

    const entities = await this.loadEntity(guids);
    const result = await this.dispatchGetEvents(entities, { skipEvents });
    return multiple ? result : (result[0] ?? null);
  }

  /**
   * @throws {Error} when not overridden and {@link BaseStorage.Entity} is unset
   */
  async create() {
    if (!this.constructor.Entity) {
      throw new Error(`create() not implemented for ${this.constructor.name}`);
    }

    const [fieldSpecs, coreFieldSpecs] = await Promise.all([
      this.getFieldSpecs(),
      this.getCoreFieldSpecs(),
    ]);

    return new this.constructor.Entity({
      instanceGuid: this.instanceGuid,
      guid: this.newGuid(),
      isNew: true,
      storage: this,
      fieldSpecs,
      coreFieldSpecs,
    });
  }

  /**
   * INSERT or UPDATE the core row, then reload field values onto the entity.
   * Override when persistence does not follow the standard core-table pattern (e.g. {@link UserStorage}).
   */
  async save(entity) {
    const saved = await this.saveCoreRow(entity);
    if (saved === null) {
      return null;
    }
    return this.reloadEntityAfterSave(entity);
  }

  /** Delete by guid (+ instance_guid when instance-scoped). */
  async delete(entityGuid) {
    return this.deleteRow(entityGuid);
  }

  /**
   * DELETE … WHERE guid and instance_guid match; returns whether a row was removed.
   *
   * @param {string} entityGuid
   */
  async deleteRow(entityGuid) {
    const { schema, table } = this.constructor;
    const { tableAlias } = this;

    const query = deleteQuery()
      .from(schema, table, tableAlias)
      .whereColumn(tableAlias, "guid", entityGuid)
      .returning(tableAlias, "guid");

    if (this.instanceGuid) {
      query.whereColumn(tableAlias, "instance_guid", this.instanceGuid);
    }

    const result = await this.query(query.toString(), query.params);
    return result.rows.length > 0;
  }

  /**
   * Lightweight existence check (guid column only).
   *
   * @param {string} entityGuid
   */
  async exists(entityGuid) {
    const { schema, table } = this.constructor;
    const { tableAlias } = this;

    const query = selectQuery()
      .from(schema, table, tableAlias)
      .addFields(tableAlias, "guid")
      .whereColumn(tableAlias, "guid", entityGuid);

    if (this.instanceGuid) {
      query.whereColumn(tableAlias, "instance_guid", this.instanceGuid);
    }

    const result = await this.query(query.toString(), query.params);
    return result.rows.length > 0;
  }
}

module.exports = { BaseStorage };
