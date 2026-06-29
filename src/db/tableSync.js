const { pool: defaultPool } = require("./pool");
const {
  alterTableQuery,
  createSchemaQuery,
  createTableQuery,
  qualifyTable,
  quoteColumn,
  quoteIdentifier,
  selectQuery,
} = require("../services/queryService");

const SESSION_SCHEMA = "genrpg";
const SESSION_TABLE = "session";

const SESSION_COLUMN_DEFS = [
  { name: "sid", type: "varchar", nullable: false },
  { name: "sess", type: "json", nullable: false },
  { name: "expire", type: "timestamp(6)", nullable: false },
  { name: "create_datetime", type: "timestamptz", nullable: false, default: "now()" },
  { name: "update_datetime", type: "timestamptz", nullable: false, default: "now()" },
];

/**
 * @param {import("pg").PoolClient} client
 */
async function ensureUpdateDatetimeFunction(client) {
  await client.query(`
    CREATE OR REPLACE FUNCTION genrpg.set_update_datetime()
    RETURNS trigger AS $$
    BEGIN
      NEW.update_datetime = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
}

/**
 * @param {string} schema
 * @param {string} table
 * @returns {string}
 */
function buildUpdateDatetimeTriggerSql(schema, table) {
  const qualified = qualifyTable(schema, table);
  const triggerName = `${table}_update_datetime`;
  return [
    `DROP TRIGGER IF EXISTS ${quoteIdentifier(triggerName)} ON ${qualified};`,
    `CREATE TRIGGER ${quoteIdentifier(triggerName)}`,
    `  BEFORE UPDATE ON ${qualified}`,
    "  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();",
  ].join("\n");
}

/**
 * Sync CREATE TABLE / ADD COLUMN DDL against PostgreSQL.
 */
class TableSync {
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
}

/**
 * Sync genrpg.session for connect-pg-simple. Runs every startup like entity base tables,
 * so it survives partial resets that drop genrpg without replaying schema_versions SQL.
 *
 * @param {import("pg").Pool} [pool]
 * @returns {Promise<{ applied: string[] }>}
 */
async function syncSessionTable(pool = defaultPool) {
  const client = await pool.connect();
  const applied = [];

  try {
    await ensureUpdateDatetimeFunction(client);

    const tableSync = new TableSync(client);
    await tableSync.ensureSchemas([SESSION_SCHEMA]);

    const createSessionTableSql = createTableQuery()
      .ifNotExists()
      .table(SESSION_SCHEMA, SESSION_TABLE);

    for (const column of SESSION_COLUMN_DEFS) {
      createSessionTableSql.addColumn(column.name, column);
    }

    createSessionTableSql.primaryKey(["sid"]);

    applied.push(
      ...await tableSync.syncTable(
        SESSION_SCHEMA,
        SESSION_TABLE,
        createSessionTableSql.toString(),
        SESSION_COLUMN_DEFS,
      ),
    );

    await client.query(
      `CREATE INDEX IF NOT EXISTS ${quoteIdentifier("idx_session_expire")} ON ${qualifyTable(SESSION_SCHEMA, SESSION_TABLE)} (${quoteColumn("expire")})`,
    );
    applied.push(`index:${SESSION_SCHEMA}.${SESSION_TABLE}:expire`);

    await client.query(buildUpdateDatetimeTriggerSql(SESSION_SCHEMA, SESSION_TABLE));
    applied.push(`trigger:${SESSION_SCHEMA}.${SESSION_TABLE}`);

    const uniqueApplied = [...new Set(applied)];
    if (uniqueApplied.length) {
      console.log(`Synced session table: ${uniqueApplied.join(", ")}`);
    }

    return { applied: uniqueApplied };
  } finally {
    client.release();
  }
}

module.exports = {
  TableSync,
  buildUpdateDatetimeTriggerSql,
  ensureUpdateDatetimeFunction,
  syncSessionTable,
};
