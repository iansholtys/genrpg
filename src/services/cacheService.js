const { pool } = require("../db/pool");
const { selectQuery, insertQuery, deleteQuery, qualify } = require("./queryService");

/** @type {Map<string, unknown>} */
const memory = new Map();

/** Keys that must never be read from or written to genrpg.cache. */
/** @type {Set<string>} */
const memoryOnlyKeys = new Set();

const tableAlias = "c";

function memoryKey(cacheKey, instanceGuid) {
  return `${cacheKey}\0${instanceGuid ?? ""}`;
}

function clearMemory() {
  memory.clear();
  memoryOnlyKeys.clear();
}

function entryMatchesEviction(key, { instanceGuid, keyPrefix } = {}) {
  const separatorIndex = key.indexOf("\0");
  const cacheKey = separatorIndex === -1 ? key : key.slice(0, separatorIndex);
  const keyInstanceGuid = separatorIndex === -1 ? "" : key.slice(separatorIndex + 1);

  if (instanceGuid !== undefined && keyInstanceGuid !== (instanceGuid ?? "")) {
    return false;
  }

  if (keyPrefix !== undefined && !cacheKey.startsWith(keyPrefix)) {
    return false;
  }

  return true;
}

function evictMemoryMatching({ instanceGuid, keyPrefix } = {}) {
  if (instanceGuid === undefined && keyPrefix === undefined) {
    memory.clear();
    memoryOnlyKeys.clear();
    return;
  }

  for (const key of memory.keys()) {
    if (entryMatchesEviction(key, { instanceGuid, keyPrefix })) {
      memory.delete(key);
    }
  }

  for (const key of memoryOnlyKeys) {
    if (entryMatchesEviction(key, { instanceGuid, keyPrefix })) {
      memoryOnlyKeys.delete(key);
    }
  }
}

/**
 * @param {string} cacheKey
 * @param {{ instanceGuid?: string | null, memoryOnly?: boolean }} [options]
 * @returns {Promise<unknown | undefined>}
 */
async function get(cacheKey, { instanceGuid = null, memoryOnly = false } = {}) {
  const key = memoryKey(cacheKey, instanceGuid);
  if (memory.has(key)) {
    return memory.get(key);
  }

  if (memoryOnly || memoryOnlyKeys.has(key)) {
    return undefined;
  }

  const query = selectQuery()
    .from("genrpg", "cache", tableAlias)
    .addFields(tableAlias, "value")
    .whereColumn(tableAlias, "cache_key", cacheKey)
    .where(
      `${qualify(tableAlias, "instance_guid")} IS NOT DISTINCT FROM $1`,
      [instanceGuid],
    );

  const result = await pool.query(query.toString(), query.params);

  if (!result.rows.length) {
    return undefined;
  }

  const value = result.rows[0].value;
  memory.set(key, value);
  return value;
}

/**
 * @param {string} cacheKey
 * @param {unknown} value
 * @param {{ instanceGuid?: string | null, memoryOnly?: boolean }} [options]
 */
async function set(cacheKey, value, { instanceGuid = null, memoryOnly = false } = {}) {
  const key = memoryKey(cacheKey, instanceGuid);
  memory.set(key, value);

  if (memoryOnly) {
    memoryOnlyKeys.add(key);
    return;
  }

  memoryOnlyKeys.delete(key);

  const query = insertQuery()
    .into("genrpg", "cache")
    .values(["cache_key", "instance_guid", "value"], [cacheKey, instanceGuid, value])
    .onConflict(["cache_key", "instance_guid"], "DO UPDATE");

  await pool.query(query.toString(), query.params);
}

/**
 * @param {string} cacheKey
 * @param {{ instanceGuid?: string | null }} [options]
 */
async function deleteKey(cacheKey, { instanceGuid = null } = {}) {
  const query = deleteQuery()
    .from("genrpg", "cache", tableAlias)
    .whereColumn(tableAlias, "cache_key", cacheKey)
    .where(
      `${qualify(tableAlias, "instance_guid")} IS NOT DISTINCT FROM $1`,
      [instanceGuid],
    );

  await pool.query(query.toString(), query.params);

  const key = memoryKey(cacheKey, instanceGuid);
  memory.delete(key);
  memoryOnlyKeys.delete(key);
}

/**
 * @param {{ instanceGuid?: string | null, keyPrefix?: string }} [options]
 * @returns {Promise<number>}
 */
async function clear({ instanceGuid, keyPrefix } = {}) {
  const query = deleteQuery().from("genrpg", "cache", tableAlias);

  if (instanceGuid !== undefined) {
    query.where(
      `${qualify(tableAlias, "instance_guid")} IS NOT DISTINCT FROM $1`,
      [instanceGuid],
    );
  }

  if (keyPrefix !== undefined) {
    query.whereColumn(tableAlias, "cache_key", `${keyPrefix}%`, "LIKE");
  }

  const result = await pool.query(query.toString(), query.params);

  evictMemoryMatching({ instanceGuid, keyPrefix });
  return result.rowCount;
}

/**
 * @param {string} cacheKey
 * @param {() => Promise<unknown>} computeFn
 * @param {{ instanceGuid?: string | null, memoryOnly?: boolean }} [options]
 */
async function getOrCompute(cacheKey, computeFn, { instanceGuid = null, memoryOnly = false } = {}) {
  const existing = await get(cacheKey, { instanceGuid, memoryOnly });
  if (existing !== undefined) {
    return existing;
  }

  const value = await computeFn();
  await set(cacheKey, value, { instanceGuid, memoryOnly });
  return value;
}

module.exports = {
  get,
  set,
  deleteKey,
  clear,
  getOrCompute,
  clearMemory,
};
