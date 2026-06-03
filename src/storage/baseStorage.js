const crypto = require("node:crypto");
const { pool } = require("../db/pool");
const { getTransactionClient } = require("../db/transactionContext");

/**
 * Base class for GenRPG storage modules.
 *
 * Storage sits below entity handlers and owns SQL plus row mapping. Obtain an
 * instance-scoped storage object via `StorageClass.forInstance(instanceGuid)`.
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
 * | `list(…)` | All domain entities for the bound instance |
 * | `load(entityGuid, …)` | One entity or `null` |
 * | `create(…)` | New in-memory entity with a GUID (not written until `save`) |
 * | `save(entity)` | INSERT or UPDATE (called from `entity.save()`) |
 * | `delete(entityGuid, …)` | Delete; `true` if a row was removed |
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

  static get schema_table() {
    const { schema, table } = this;
    if (!schema || !table) {
      throw new Error(`${this.name} must define static schema and table`);
    }
    return `${schema}.${table}`;
  }

  constructor(instanceGuid) {
    if (!instanceGuid) {
      throw new Error("instanceGuid is required for storage modules");
    }
    this.instanceGuid = instanceGuid;
  }

  static forInstance(instanceGuid) {
    return new this(instanceGuid);
  }

  get pool() {
    return pool;
  }

  get schema_table() {
    return this.constructor.schema_table;
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
   * @throws {Error} when not overridden
   */
  async list() {
    throw new Error(`list() not implemented for ${this.constructor.name}`);
  }

  /**
   * @throws {Error} when not overridden
   */
  async load() {
    throw new Error(`load() not implemented for ${this.constructor.name}`);
  }

  /**
   * @throws {Error} when not overridden
   */
  async create() {
    throw new Error(`create() not implemented for ${this.constructor.name}`);
  }

  /**
   * @throws {Error} when not overridden
   */
  async save() {
    throw new Error(`save() not implemented for ${this.constructor.name}`);
  }

  /**
   * Delete by guid + instance_guid. Override when delete logic differs (e.g. multi-table).
   */
  async delete(entityGuid) {
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
