const { pool: defaultPool } = require("../db/pool");
const { createTableQuery, createBeforeUpdateTriggerQuery, qualifyTable, quoteIdentifier, quoteColumn } = require("../services/queryService");
const {
  loadEntitiesForPackages,
  loadMergedCoreFieldSpecs,
  loadMergedUniqueConstraints,
} = require("./fieldManifest");
const { TableSync } = require("../db/tableSync");

/**
 * @param {{ instanceScoped: boolean }} entityDef
 * @param {Record<string, object>} coreFieldSpecs
 * @returns {{ name: string, type: string, nullable?: boolean, default?: string }[]}
 */
function baseTableColumnDefs(entityDef, coreFieldSpecs) {
  const columnDefs = [
    { name: "guid", type: "uuid", nullable: false, default: "gen_random_uuid()" },
    { name: "create_datetime", type: "timestamptz", nullable: false, default: "now()" },
    { name: "update_datetime", type: "timestamptz", nullable: false, default: "now()" },
  ];

  if (entityDef.instanceScoped) {
    columnDefs.push({ name: "instance_guid", type: "uuid", nullable: false });
  }

  for (const spec of Object.values(coreFieldSpecs)) {
    columnDefs.push({
      name: spec.column,
      type: spec.columnType,
      nullable: false,
      ...(spec.columnDefault !== undefined ? { default: spec.columnDefault } : {}),
    });
  }

  return columnDefs;
}

/**
 * @param {{ schema: string, table: string, instanceScoped: boolean }} entityDef
 * @param {{ name: string, type: string, nullable?: boolean, default?: string }[]} columnDefs
 * @returns {string}
 */
function createBaseTableSql(entityDef, columnDefs) {
  const { schema, table, instanceScoped } = entityDef;
  const query = createTableQuery().ifNotExists().table(schema, table);

  for (const column of columnDefs) {
    query.addColumn(column.name, column);
  }

  query.primaryKey(["guid"]);

  if (instanceScoped) {
    query.foreignKey(`${table}_instance_fk`, "instance_guid", "genrpg", "instances", "guid", { onDelete: "CASCADE" });
  }

  return query.toString();
}

/**
 * @param {string} schema
 * @param {string} table
 * @param {string[]} columns
 * @returns {string}
 */
function buildUniqueIndexSql(schema, table, columns) {
  const indexName = `uniq_${table}_${columns.join("_")}`;
  const columnList = columns.map((name) => quoteColumn(name)).join(", ");
  return `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier(indexName)} ON ${qualifyTable(schema, table)} (${columnList})`;
}

/**
 * Ensure entity base tables exist for registered entities.
 *
 * @param {{ pool?: import("pg").Pool, packageNames?: string[] | null }} [options]
 * @returns {Promise<{ applied: string[] }>}
 */
async function applyEntityBaseTables({ pool = defaultPool, packageNames = null } = {}) {
  const [entities, coreFieldsByEntity, uniqueConstraintsByEntity] = await Promise.all([
    loadEntitiesForPackages(),
    loadMergedCoreFieldSpecs(packageNames),
    loadMergedUniqueConstraints(packageNames),
  ]);

  let entityEntries = Object.entries(entities);
  if (packageNames != null) {
    const packageSchemas = new Set(packageNames);
    entityEntries = entityEntries.filter(([, entityDef]) => packageSchemas.has(entityDef.schema));
  }

  const instanceIndex = entityEntries.findIndex(([entityKey]) => entityKey === "instance");
  if (instanceIndex > 0) {
    const [instanceEntry] = entityEntries.splice(instanceIndex, 1);
    entityEntries.unshift(instanceEntry);
  }

  const client = await pool.connect();
  const applied = [];

  try {
    const tableSync = new TableSync(client);
    await tableSync.ensureSchemas(new Set(entityEntries.map(([, entityDef]) => entityDef.schema)));

    for (const [entityKey, entityDef] of entityEntries) {
      const { schema, table, instanceScoped } = entityDef;
      const coreFieldSpecs = coreFieldsByEntity[entityKey] ?? {};
      const uniqueConstraints = uniqueConstraintsByEntity[entityKey] ?? [];
      const columnDefs = baseTableColumnDefs(entityDef, coreFieldSpecs);

      applied.push(
        ...await tableSync.syncTable(
          schema,
          table,
          createBaseTableSql(entityDef, columnDefs),
          columnDefs,
        ),
      );

      if (instanceScoped) {
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_${table}_instance ON ${qualifyTable(schema, table)} (instance_guid)`,
        );
        applied.push(`index:${schema}.${table}:instance_guid`);
      }

      for (const spec of Object.values(coreFieldSpecs)) {
        const { column, unique } = spec;
        if (!unique) {
          continue;
        }
        await client.query(buildUniqueIndexSql(schema, table, [column]));
        applied.push(`unique:${schema}.${table}:${column}`);
      }

      for (const constraint of uniqueConstraints) {
        const { columns } = constraint;
        await client.query(buildUniqueIndexSql(schema, table, columns));
        applied.push(`unique:${schema}.${table}:${columns.join(",")}`);
      }

      await client.query(
        createBeforeUpdateTriggerQuery(schema, table, "update_datetime", "genrpg"),
      );
      applied.push(`trigger:${schema}.${table}`);
    }

    return { applied: [...new Set(applied)] };
  } finally {
    client.release();
  }
}

module.exports = {
  applyEntityBaseTables,
};
