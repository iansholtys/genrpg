const crypto = require("node:crypto");
const { pool } = require("../db/pool");
const { getTransactionClient } = require("../db/transactionContext");
const {
  getCachedExtensionFieldSpecs,
  getCachedExtensionJoinSql,
  saveExtensionRows,
  deleteExtensionRows,
  packageDataFromRow,
  flattenPackageDataForEntity,
} = require("../lib/entityExtensions");

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
 * | `loadEntity(entityGuid, …)` | Query and map one row to an entity (override in subclasses) |
 * | `list(…)` | Calls `listEntities()`, then preGet/postGet when configured |
 * | `load(entityGuid, …)` | Calls `loadEntity()`, then preGet/postGet when configured |
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

  constructor(instanceGuid, packageNames = []) {
    if (!instanceGuid) {
      throw new Error("instanceGuid is required for storage modules");
    }
    this.instanceGuid = instanceGuid;
    this.packageNames = packageNames;
  }

  static forInstance(instance) {
    if (!instance.guid) {
      throw new Error("instance guid is required for storage modules");
    }

    return new this(instance.guid, Object.keys(instance.packages));
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
    const Entity = this.entityClass;
    return getCachedExtensionFieldSpecs(
      Entity.key,
      this.packageNames,
      Object.keys(Entity.fields),
      this.instanceGuid,
    );
  }

  async getExtensionJoinSql(coreTableAlias) {
    return getCachedExtensionJoinSql(
      this.entityClass.key,
      this.packageNames,
      coreTableAlias,
      this.instanceGuid,
    );
  }

  async saveExtensionRowsForEntity(entity) {
    await saveExtensionRows(
      this.entityClass.key,
      this.packageNames,
      entity.guid,
      entity,
      (text, params) => this.query(text, params),
    );
  }

  async extensionContextFromRow(row) {
    const extensionFieldSpecs = await this.getExtensionFieldSpecs();
    const packageData = packageDataFromRow(row.package_extensions);
    const extensionValues = flattenPackageDataForEntity(packageData, extensionFieldSpecs);
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
   * Load one entity by guid from the database, or `null` when missing.
   *
   * Subclasses implement query + `toEntity()` here. Do not dispatch get events —
   * {@link BaseStorage.load} wraps this and runs preGet/postGet for callers.
   *
   * @throws {Error} when not overridden
   */
  async loadEntity(entityGuid) {
    throw new Error(`loadEntity() not implemented for ${this.constructor.name}`);
  }

  /**
   * Run preGet/postGet for a list of already-hydrated entities.
   * Used by {@link BaseStorage.list} and {@link BaseStorage.load}; rarely called directly.
   */
  async publishGetList(entities, { skipEvents = false } = {}) {
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

  async publishGetEntity(entity, { skipEvents = false } = {}) {
    if (!entity) {
      return null;
    }

    if (skipEvents) {
      return entity;
    }

    const [published] = await this.publishGetList([entity]);
    return published ?? null;
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
    return this.publishGetList(entities, { skipEvents });
  }

  /**
   * Load one entity by guid, with get lifecycle events when configured.
   *
   * @param {{ skipEvents?: boolean }} [options]
   */
  async load(entityGuid, { skipEvents = false } = {}) {
    const entity = await this.loadEntity(entityGuid);
    return this.publishGetEntity(entity, { skipEvents });
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
    if (this.constructor.Entity) {
      await deleteExtensionRows(
        this.entityClass.key,
        this.packageNames,
        entityGuid,
        (text, params) => this.query(text, params),
      );
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

  /**
   * Lightweight existence check (guid column only).
   *
   * @param {string} entityGuid
   * @param {string} [qualifiedTable] defaults to `this.schema_table`
   */
  async exists(entityGuid, qualifiedTable) {
    const table = qualifiedTable ?? this.schema_table;
    const result = await this.query(
      `
        SELECT guid
        FROM ${table}
        WHERE guid = $1 AND instance_guid = $2
      `,
      [entityGuid, this.instanceGuid],
    );
    return result.rows.length > 0;
  }
}

module.exports = { BaseStorage };
