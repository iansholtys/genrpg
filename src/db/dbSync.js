const { pool: defaultPool } = require("./pool");
const { createSchemaQuery, insertQuery } = require("../services/queryService");
const { invalidateApplicationCaches } = require("../services/cacheService");
const { TableSync } = require("./tableSync");
const { applyEntityBaseTables } = require("../fields/applyEntityBaseTables");
const { applyFieldTables } = require("../fields/applyFieldTables");

const GENRPG_SCHEMA = "genrpg";

/**
 * Ensure PostgreSQL schemas and DDL for the given packages.
 *
 * Defaults to genrpg only (startup / `npm run db:apply`). When genrpg is included,
 * session is created before entity base tables (provides set_update_datetime); cache
 * is created after entity base tables (references instances); the genrpg package
 * registry row is ensured last.
 *
 * @param {{ pool?: import("pg").Pool, packageNames?: string[] }} [options]
 * @returns {Promise<{ entityBaseTables: { applied: string[] }, fieldTables: { applied: string[] } }>}
 */
async function syncDatabase({ pool = defaultPool, packageNames = [GENRPG_SCHEMA] } = {}) {
  if (!packageNames.length) {
    throw new Error("packageNames is required");
  }

  const label = packageNames.join(", ");
  const updatingCore = packageNames.includes(GENRPG_SCHEMA);

  for (const name of packageNames) {
    await pool.query(createSchemaQuery(name));
  }

  if (updatingCore) {
    await TableSync.ensureSessionTable(pool);
  }

  // Entity base tables before cache because cache references instance entities.
  const entityBaseTables = await applyEntityBaseTables({ pool, packageNames });
  if (entityBaseTables.applied.length) {
    console.log(`Synced entity base tables for ${label}: ${entityBaseTables.applied.join(", ")}`);
  }

  if (updatingCore) {
    await TableSync.ensureCacheTable(pool);
  }

  const fieldTables = await applyFieldTables({ pool, packageNames });
  if (fieldTables.applied.length) {
    console.log(`Synced field tables for ${label}: ${fieldTables.applied.join(", ")}`);
  }

  if (updatingCore) {
    const query = insertQuery()
      .into(GENRPG_SCHEMA, "packages")
      .values(["machine_name", "version"], [GENRPG_SCHEMA, 0])
      .onConflict(["machine_name"], "DO NOTHING");
    await pool.query(query.toString(), query.params);
  }

  if (entityBaseTables.applied.length || fieldTables.applied.length) {
    await invalidateApplicationCaches();
  }

  return { entityBaseTables, fieldTables };
}

// `npm run db:apply` runs this file directly; importing it (e.g. from server.js) skips this block.
if (require.main === module) {
  syncDatabase()
    .finally(() => defaultPool.end())
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  syncDatabase,
};
