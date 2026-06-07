const crypto = require("node:crypto");
const { pool } = require("../db/pool");
const { getTransactionClient } = require("../db/transactionContext");
const { getOrCompute } = require("../services/cacheService");
const { select } = require("../services/queryService");
const {
  buildExtensionFieldSpecs,
  saveExtensionRows,
  extensionRowAlias,
  loadExtensionSchemas,
  quoteColumn,
  quoteIdentifier,
} = require("../lib/entityExtensions");
const { propertyToColumnName } = require("../lib/entityExtensionIndex");

/**
 * Base class for GenRPG storage modules.
 *
 * Storage sits below entity handlers and owns SQL plus row mapping. Obtain an
 * instance-scoped storage object via `StorageClass.forInstance(source)`, where
 * `instance` is a binding object `{ guid, packages? }` from request context, where
 * `packages` is always `{ [machineName]: humanLabel }` (empty when not loaded from the DB).
 *
 * Queries use the active transaction client from AsyncLocalStorage when inside
 * `withTransaction()`; otherwise they use the connection pool.
 *
 * ## Instance-scoped entity convention
 *
 * For a single table keyed by `(guid, instance_guid)`, define `static schema` and
 * `static table` (see `schema_table`). Implement:
 *
 * | Method | Purpose |
 * |--------|---------|
 * | `listEntities(…)` | Query and map rows to entities (override in subclasses) |
 * | `loadEntity(entityGuids, …)` | Load entities for the given guids (always an array) |
 * | `list(…)` | Calls `listEntities()`, then preGet/postGet when configured |
 * | `load(entityGuid \| entityGuids, …)` | Calls `loadEntity()`, then preGet/postGet when configured |
 * | `create(…)` | New in-memory entity with a GUID (not written until `save`) |
 * | `save(entity)` | INSERT or UPDATE (called from `entity.save()`) |
 * | `delete(entityGuid, …)` | Delete; `true` if a row was removed |
 *
 * Subclasses implement `listEntities(…)` / `loadEntity()` (SQL, filters, ordering).
 * Callers use `list()` / `load()` — the base class runs get lifecycle events there.
 * Pass `{ skipEvents: true }` only when hydration must bypass package get handlers
 * (rare; most reloads after save should use plain `load()` so postGet enrichment runs).
 *
 * Filter args (e.g. `{ characterGuid }`) are forwarded from `list()` to `listEntities()`.
 * Storages without filters implement `listEntities()` with no parameters.
 *
 * Writes must run inside `withTransaction()` from `src/db/transactionContext.js`.
 *
 * ## Row hydration
 *
 * Map SQL rows to entity instances via `toEntity(row)` (or resource-specific
 * names such as `toCollectionEntity` when one storage module serves multiple
 * entity types). Row mapping lives on storage alongside `create()`.
 */
class BaseStorage {
  /** @type {string | undefined} */
  static schema;

  /** @type {string | undefined} */
  static table;

  /**
   * Entity class this storage serves. Required for storages with package field extensions.
   * @type {typeof import("../entities/baseEntity").BaseEntity | undefined}
   */
  static Entity;

  static get schema_table() {
    const { schema, table } = this;
    if (!schema || !table) {
      throw new Error(`${this.name} must define static schema and table`);
    }
    return `${schema}.${table}`;
  }

  /**
   * When false, storage is global (not keyed by instance_guid). {@link BaseStorage.forInstance}
   * returns a storage instance with no instance binding.
   */
  static get instanceScoped() {
    return true;
  }

  constructor(instanceGuid, packageNames = []) {
    if (this.constructor.instanceScoped && !instanceGuid) {
      throw new Error("instanceGuid is required for storage modules");
    }
    this.instanceGuid = instanceGuid;
    this.packageNames = packageNames;
  }

  static forInstance(instance) {
    if (!this.instanceScoped) {
      return new this(null, []);
    }

    if (!instance?.guid) {
      throw new Error("instance guid is required for storage modules");
    }

    return new this(instance.guid, Object.keys(instance.packages || {}));
  }

  /** Global (non-instance) storage binding. Only valid when {@link BaseStorage.instanceScoped} is false. */
  static global() {
    if (this.instanceScoped) {
      throw new Error(`${this.name} is instance-scoped`);
    }
    return new this(null, []);
  }

  get pool() {
    return pool;
  }

  get schema_table() {
    return this.constructor.schema_table;
  }

  /** @returns {typeof import("../entities/baseEntity").BaseEntity} */
  get entityClass() {
    const Entity = this.constructor.Entity;
    if (!Entity) {
      throw new Error(`${this.constructor.name} must define static Entity`);
    }
    return Entity;
  }

  async getExtensionFieldSpecs() {
    const { constructor, packageNames, instanceGuid, entityClass } = this;
    return getOrCompute(
      `entity.field_extensions:${entityClass.key}`,
      () => buildExtensionFieldSpecs(constructor, packageNames, Object.keys(entityClass.fields)),
      { instanceGuid },
    );
  }

  /**
   * Column names for the core entity table: guid, non-virtual entity fields,
   * and instance_guid when instance-scoped.
   */
  getCoreEntityFields() {
    const columns = [
      "guid",
      ...Object.entries(this.entityClass.fields)
        .filter(([, spec]) => !spec.virtual)
        .map(([key]) => propertyToColumnName(key)),
    ];

    if (this.constructor.instanceScoped) {
      columns.push("instance_guid");
    }

    return [...new Set(columns)];
  }

  /** Alias for the core table in SELECT queries built by {@link BaseStorage.buildSelect}. */
  get tableAlias() {
    return "t";
  }

  async buildSelect() {
    const { schema, table } = this.constructor;
    const { tableAlias } = this;

    const query = select()
      .from(schema, table, tableAlias)
      .addFields(tableAlias, this.getCoreEntityFields());
    await this.addExtensionFields(query, tableAlias);

    return query;
  }

  async addExtensionFields(query, coreTableAlias) {
    // Get extension field specs from cache or compute them
    const extensionFieldSpecs = await this.getExtensionFieldSpecs();
    if (!Object.keys(extensionFieldSpecs).length) {
      return query;
    }

    // Group field specs by schema
    const specsBySchema = new Map();
    for (const spec of Object.values(extensionFieldSpecs)) {
      const { schema } = spec;
      if (!specsBySchema.has(schema)) {
        specsBySchema.set(schema, []);
      }
      specsBySchema.get(schema).push(spec);
    }

    // Add a join and fields for each schema
    const parentKeyColumn = `${this.entityClass.key}_guid`;
    let joinIndex = 0;
    for (const [schema, specs] of specsBySchema) {
      joinIndex += 1;
      const joinAlias = `ext${joinIndex}`;

      query.addLeftJoin(
        schema,
        this.constructor.table,
        joinAlias,
        `${joinAlias}.${quoteColumn(parentKeyColumn)} = ${coreTableAlias}.guid`,
      );

      query.addFields(
        joinAlias,
        specs.map((spec) => spec.column),
        specs.map((spec) => extensionRowAlias(spec)),
      );
    }

    return query;
  }

  async saveExtensionRowsForEntity(entity) {
    await saveExtensionRows(
      this.constructor,
      this.packageNames,
      entity.guid,
      entity,
      (text, params) => this.query(text, params),
    );
  }

  async extensionContextFromRow(row) {
    const extensionFieldSpecs = await this.getExtensionFieldSpecs();
    const packageData = {};
    const extensionValues = {};

    for (const [property, spec] of Object.entries(extensionFieldSpecs)) {
      const raw = row[extensionRowAlias(spec)];
      if (raw === undefined) {
        continue;
      }

      extensionValues[property] = raw;
      if (!packageData[spec.schema]) {
        packageData[spec.schema] = {};
      }
      packageData[spec.schema][spec.column] = raw;
    }

    return { extensionFieldSpecs, packageData, extensionValues };
  }

  assignExtensionFieldsFromReload(entity, reloaded) {
    for (const key of Object.keys(entity.extensionFieldSpecs)) {
      if (key in reloaded) {
        entity[key] = reloaded[key];
      }
    }
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
   * Load all entities for this instance from the database.
   *
   * Subclasses implement query + `toEntity()` here. Do not dispatch get events —
   * {@link BaseStorage.list} wraps this and runs preGet/postGet for callers.
   *
   * @throws {Error} when not overridden
   */
  async listEntities() {
    throw new Error(`listEntities() not implemented for ${this.constructor.name}`);
  }

  /**
   * Load entities for the given guids. Called only with a non-empty array from {@link BaseStorage.load}.
   *
   * Subclasses implement query + `toEntity()` here. Do not dispatch get events —
   * {@link BaseStorage.load} wraps this and dispatches preGet/postGet for callers.
   *
   * @param {string[]} entityGuids non-empty
   * @throws {Error} when not overridden
   */
  async loadEntity(entityGuids) {
    throw new Error(`loadEntity() not implemented for ${this.constructor.name}`);
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

    const { instanceGuid } = this;
    const pre = await entities[0].dispatchEvent(
      "preGet",
      { entities, instanceGuid },
    );
    const preEntities = pre?.entities ?? entities;

    const post = await entities[0].dispatchEvent(
      "postGet",
      { entities: preEntities, instanceGuid },
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

    const extensionFieldSpecs = await this.getExtensionFieldSpecs();
    return new this.constructor.Entity({
      instanceGuid: this.instanceGuid,
      guid: this.newGuid(),
      isNew: true,
      storage: this,
      packageNames: this.packageNames,
      extensionFieldSpecs,
    });
  }

  /**
   * @throws {Error} when not overridden
   */
  async save() {
    throw new Error(`save() not implemented for ${this.constructor.name}`);
  }

  /**
   * Delete by guid + instance_guid. Removes package extension rows when {@link BaseStorage.Entity} is set.
   */
  async delete(entityGuid) {
    const { constructor, packageNames } = this;
    if (constructor.Entity) {
      const { schema: coreSchema, table } = constructor;
      const parentKeyColumn = `${constructor.Entity.key}_guid`;
      const schemaRows = await loadExtensionSchemas(coreSchema, table, parentKeyColumn, packageNames);
      const schemas = schemaRows
        .map((row) => row.schema)
        .filter((schema) => schema !== coreSchema);

      for (const schema of schemas) {
        await this.query(
          `
            DELETE FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}
            WHERE ${quoteColumn(parentKeyColumn)} = $1
          `,
          [entityGuid],
        );
      }
    }
    return this.deleteRow(entityGuid);
  }

  /**
   * DELETE … WHERE guid and instance_guid match; returns whether a row was removed.
   *
   * @param {string} entityGuid
   * @param {string} [qualifiedTable] defaults to `this.schema_table`
   */
  async deleteRow(entityGuid, qualifiedTable) {
    const table = qualifiedTable ?? this.schema_table;

    if (this.instanceGuid) {
      const result = await this.query(
        `
          DELETE FROM ${table}
          WHERE guid = $1 AND instance_guid = $2
          RETURNING guid
        `,
        [entityGuid, this.instanceGuid],
      );
      return result.rows.length > 0;
    }

    const result = await this.query(
      `
        DELETE FROM ${table}
        WHERE guid = $1
        RETURNING guid
      `,
      [entityGuid],
    );
    return result.rows.length > 0;
  }

  /**
   * Lightweight existence check (guid column only).
   *
   * @param {string} entityGuid
   */
  async exists(entityGuid) {
    const { schema, table } = this.constructor;
    const tableAlias = "t";

    const query = select()
      .from(schema, table, tableAlias)
      .addFields(tableAlias, "guid")
      .where(`"guid" = $1`, [entityGuid]);

    if (this.instanceGuid) {
      query.where(`"instance_guid" = $1`, [this.instanceGuid]);
    }

    const result = await this.query(query.toString(), query.params);
    return result.rows.length > 0;
  }
}

module.exports = { BaseStorage };
