const { pool: defaultPool } = require("../db/pool");
const { createTableQuery, alterTableQuery, selectQuery } = require("../services/queryService");
const { loadAllFieldSpecs } = require("./fieldManifest");

/**
 * @param {object} spec normalized field spec from fieldManifest
 * @returns {string}
 */
function buildCreateFieldTableSql(spec) {
  const query = createTableQuery()
    .ifNotExists()
    .table(spec.schema, spec.table)
    .addColumn("entity_guid", { type: "uuid", nullable: false })
    .addColumn("delta", { type: "integer", nullable: false, default: "0" });

  for (const column of spec.fieldType.columns) {
    query.addColumn(column.name, {
      type: column.type,
      nullable: column.nullable,
      default: column.default,
    });
  }

  query
    .primaryKey(["entity_guid", "delta"])
    .foreignKey(`${spec.table}_entity_fk`, "entity_guid", spec.entitySchema, spec.entityTable, "guid", {
      onDelete: "CASCADE",
    });

  return query.toString();
}

/**
 * @param {object} spec
 * @param {string[]} existingColumns column names on the table
 * @returns {string[]} ALTER TABLE statements (empty when nothing to add)
 */
function buildAddMissingColumnSql(spec, existingColumns) {
  const existing = new Set(existingColumns.map((name) => name.toLowerCase()));
  const missing = spec.fieldType.columns.filter(
    (column) => !existing.has(column.name.toLowerCase()),
  );

  if (!missing.length) {
    return [];
  }

  const query = alterTableQuery().table(spec.schema, spec.table);
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
 * Ensure field tables exist for the given package machine names.
 * Creates package schemas, CREATE TABLE IF NOT EXISTS, then ADD COLUMN for new payload columns.
 *
 * @param {{ pool?: import("pg").Pool, packageNames?: string[] }} [options]
 * @returns {Promise<{ applied: string[] }>}
 */
async function applyFieldTables({ pool = defaultPool, packageNames = null } = {}) {
  const specs = await loadAllFieldSpecs(packageNames);
  const client = await pool.connect();
  const applied = [];

  try {
    const schemas = new Set(specs.map((spec) => spec.schema));
    for (const schema of schemas) {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    }

    for (const spec of specs) {
      await client.query(buildCreateFieldTableSql(spec));
      applied.push(`create:${spec.schema}.${spec.table}`);

      const columnsQuery = selectQuery()
        .from("information_schema", "columns", "c")
        .addFields("c", "column_name")
        .whereColumn("c", "table_schema", spec.schema)
        .whereColumn("c", "table_name", spec.table)
        .orderBy("c", "ordinal_position");

      const columnsResult = await client.query(columnsQuery.toString(), columnsQuery.params);
      const columns = columnsResult.rows.map((row) => row.column_name);

      for (const alterSql of buildAddMissingColumnSql(spec, columns)) {
        await client.query(alterSql);
        applied.push(`alter:${spec.schema}.${spec.table}`);
      }
    }

    return { applied: [...new Set(applied)] };
  } finally {
    client.release();
  }
}

module.exports = {
  applyFieldTables,
};
