const { pool: defaultPool } = require("../db/pool");
const { createTableQuery } = require("../services/queryService");
const { loadAllFieldSpecs } = require("./fieldManifest");
const { TableSync } = require("./tableSync");

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
 * @returns {{ name: string, type: string, nullable?: boolean, default?: string }[]}
 */
function fieldTableColumnDefs(spec) {
  return [
    { name: "entity_guid", type: "uuid", nullable: false },
    { name: "delta", type: "integer", nullable: false, default: "0" },
    ...spec.fieldType.columns.map((column) => ({
      name: column.name,
      type: column.type,
      nullable: column.nullable,
      default: column.default,
    })),
  ];
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
    const tableSync = new TableSync(client);
    await tableSync.ensureSchemas(new Set(specs.map((spec) => spec.schema)));

    for (const spec of specs) {
      applied.push(
        ...await tableSync.syncTable(
          spec.schema,
          spec.table,
          buildCreateFieldTableSql(spec),
          fieldTableColumnDefs(spec),
        ),
      );
    }

    return { applied: [...new Set(applied)] };
  } finally {
    client.release();
  }
}

module.exports = {
  applyFieldTables,
};
