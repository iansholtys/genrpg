const { pool: defaultPool } = require("./pool");
const {
  alterTableQuery,
  createBeforeUpdateTriggerQuery,
  createUpdateFunctionQuery,
  createSchemaQuery,
  createTableQuery,
  qualifyTable,
  quoteColumn,
  quoteIdentifier,
  selectQuery,
} = require("../services/queryService");

/**
 * Sync CREATE TABLE / ADD COLUMN DDL against PostgreSQL.
 */
class TableSync {
  static GENRPG_SCHEMA = "genrpg";

  /**
   * @param {import("pg").PoolClient} client
   */
  constructor(client) {
    this.client = client;
  }

  /**
   * @param {Iterable<string>} schemaNames
   */
  async ensureSchemas(schemaNames) {
    for (const schema of schemaNames) {
      await this.client.query(createSchemaQuery(schema));
    }
  }

  /**
   * CREATE TABLE IF NOT EXISTS, then ADD COLUMN for any missing definitions.
   *
   * @param {string} schema
   * @param {string} table
   * @param {string} createSql
   * @param {{ name: string, type: string, nullable?: boolean, default?: string }[]} columnDefs
   * @returns {Promise<string[]>} applied action tags
   */
  async syncTable(schema, table, createSql, columnDefs) {
    const applied = [];

    await this.client.query(createSql);
    applied.push(`create:${schema}.${table}`);

    const columnsQuery = selectQuery()
      .from("information_schema", "columns", "c")
      .addFields("c", "column_name")
      .whereColumn("c", "table_schema", schema)
      .whereColumn("c", "table_name", table)
      .orderBy("c", "ordinal_position");

    const columnsResult = await this.client.query(columnsQuery.toString(), columnsQuery.params);
    const existing = new Set(columnsResult.rows.map((row) => row.column_name.toLowerCase()));
    const missing = columnDefs.filter((column) => !existing.has(column.name.toLowerCase()));

    if (missing.length) {
      const alterQuery = alterTableQuery().table(schema, table);
      for (const column of missing) {
        alterQuery.addColumn(column.name, {
          type: column.type,
          nullable: column.nullable,
          default: column.default,
        });
      }

      const statements = alterQuery.addColumnIfNotExists().toString().split("\n").filter(Boolean);
      for (const sql of statements) {
        await this.client.query(sql);
      }

      applied.push(`alter:${schema}.${table}`);
    }

    return applied;
  }

  /**
   * Create genrpg.session for connect-pg-simple if missing. Schema changes use update steps.
   *
   * @param {import("pg").Pool} [pool]
   */
  static async ensureSessionTable(pool = defaultPool) {
    const schema = TableSync.GENRPG_SCHEMA;
    const table = "session";
    const updateDatetimeColumn = "update_datetime";

    const client = await pool.connect();
    try {
      await client.query(createUpdateFunctionQuery(schema, updateDatetimeColumn));
      await client.query(
        createTableQuery()
          .ifNotExists()
          .table(schema, table)
          .addColumn("sid", { type: "varchar", nullable: false })
          .addColumn("sess", { type: "json", nullable: false })
          .addColumn("expire", { type: "timestamp(6)", nullable: false })
          .addColumn("create_datetime", { type: "timestamptz", nullable: false, default: "now()" })
          .addColumn("update_datetime", { type: "timestamptz", nullable: false, default: "now()" })
          .primaryKey(["sid"])
          .toString(),
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS ${quoteIdentifier("idx_session_expire")} ON ${qualifyTable(schema, table)} (${quoteColumn("expire")})`,
      );
      await client.query(createBeforeUpdateTriggerQuery(schema, table, updateDatetimeColumn));
    } finally {
      client.release();
    }
  }

  /**
   * Create genrpg.cache if missing. Requires genrpg.instances. Schema changes use update steps.
   *
   * @param {import("pg").Pool} [pool]
   */
  static async ensureCacheTable(pool = defaultPool) {
    const schema = TableSync.GENRPG_SCHEMA;
    const table = "cache";
    const cachedDatetimeColumn = "cached_datetime";

    const client = await pool.connect();
    try {
      await client.query(createUpdateFunctionQuery(schema, cachedDatetimeColumn));
      const qualified = qualifyTable(schema, table);
      await client.query(
        [
          `CREATE TABLE IF NOT EXISTS ${qualified} (`,
          "  cache_key text NOT NULL,",
          "  instance_guid uuid REFERENCES genrpg.instances(guid) ON DELETE CASCADE,",
          "  value jsonb NOT NULL,",
          "  cached_datetime timestamptz NOT NULL DEFAULT now(),",
          "  UNIQUE NULLS NOT DISTINCT (cache_key, instance_guid)",
          ")",
        ].join("\n"),
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS ${quoteIdentifier("idx_cache_instance")} ON ${qualified} (${quoteColumn("instance_guid")}) WHERE instance_guid IS NOT NULL`,
      );
      await client.query(createBeforeUpdateTriggerQuery(schema, table, cachedDatetimeColumn));
    } finally {
      client.release();
    }
  }
}

module.exports = {
  TableSync,
};
