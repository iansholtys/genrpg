const { alterTableQuery, selectQuery } = require("../services/queryService");

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
      await this.client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
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

module.exports = {
  TableSync,
};
