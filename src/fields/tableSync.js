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
   * @param {string} schema
   * @param {string} table
   * @returns {Promise<string[]>}
   */
  async listColumns(schema, table) {
    const columnsQuery = selectQuery()
      .from("information_schema", "columns", "c")
      .addFields("c", "column_name")
      .whereColumn("c", "table_schema", schema)
      .whereColumn("c", "table_name", table)
      .orderBy("c", "ordinal_position");

    const result = await this.client.query(columnsQuery.toString(), columnsQuery.params);
    return result.rows.map((row) => row.column_name);
  }

  /**
   * @param {string} schema
   * @param {string} table
   * @param {{ name: string, type: string, nullable?: boolean, default?: string }[]} columnDefs
   * @param {string[]} existingColumns
   * @returns {string[]}
   */
  static buildAddMissingColumnsSql(schema, table, columnDefs, existingColumns) {
    const existing = new Set(existingColumns.map((name) => name.toLowerCase()));
    const missing = columnDefs.filter((column) => !existing.has(column.name.toLowerCase()));

    if (!missing.length) {
      return [];
    }

    const query = alterTableQuery().table(schema, table);
    for (const column of missing) {
      query.addColumn(column.name, {
        type: column.type,
        nullable: column.nullable,
        default: column.default,
      });
    }

    return query.addColumnIfNotExists().toString().split("\n").filter(Boolean);
  }

  /**
   * @param {string} schema
   * @param {string} table
   * @param {{ name: string, type: string, nullable?: boolean, default?: string }[]} columnDefs
   * @returns {Promise<boolean>} true when at least one ALTER was applied
   */
  async applyMissingColumns(schema, table, columnDefs) {
    const existingColumns = await this.listColumns(schema, table);
    const statements = TableSync.buildAddMissingColumnsSql(schema, table, columnDefs, existingColumns);

    for (const sql of statements) {
      await this.client.query(sql);
    }

    return statements.length > 0;
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

    if (await this.applyMissingColumns(schema, table, columnDefs)) {
      applied.push(`alter:${schema}.${table}`);
    }

    return applied;
  }
}

module.exports = {
  TableSync,
};
