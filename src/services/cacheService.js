const { pool } = require("../db/pool");

/** @type {Map<string, unknown>} */
const memory = new Map();

function memoryKey(cacheKey, instanceGuid) {
  return `${cacheKey}\0${instanceGuid ?? ""}`;
}

function clearMemory() {
  memory.clear();
}

function evictMemoryMatching({ instanceGuid, keyPrefix } = {}) {
  if (instanceGuid === undefined && keyPrefix === undefined) {
    memory.clear();
    return;
  }

  for (const key of memory.keys()) {
    const separatorIndex = key.indexOf("\0");
    const cacheKey = separatorIndex === -1 ? key : key.slice(0, separatorIndex);
    const keyInstanceGuid = separatorIndex === -1 ? "" : key.slice(separatorIndex + 1);

    if (instanceGuid !== undefined && keyInstanceGuid !== (instanceGuid ?? "")) {
      continue;
    }

    if (keyPrefix !== undefined && !cacheKey.startsWith(keyPrefix)) {
      continue;
    }

    memory.delete(key);
  }
}

/**
 * @param {string} cacheKey
 * @param {{ instanceGuid?: string | null }} [options]
 * @returns {Promise<unknown | undefined>}
 */
async function get(cacheKey, { instanceGuid = null } = {}) {
  const key = memoryKey(cacheKey, instanceGuid);
  if (memory.has(key)) {
    return memory.get(key);
  }

  const result = await pool.query(
    `
      SELECT value
      FROM genrpg.cache
      WHERE cache_key = $1
        AND instance_guid IS NOT DISTINCT FROM $2
    `,
    [cacheKey, instanceGuid],
  );

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
 * @param {{ instanceGuid?: string | null }} [options]
 */
async function set(cacheKey, value, { instanceGuid = null } = {}) {
  await pool.query(
    `
      INSERT INTO genrpg.cache (cache_key, instance_guid, value, cached_datetime)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (cache_key, instance_guid)
      DO UPDATE SET
        value = EXCLUDED.value,
        cached_datetime = now()
    `,
    [cacheKey, instanceGuid, value],
  );

  memory.set(memoryKey(cacheKey, instanceGuid), value);
}

/**
 * @param {string} cacheKey
 * @param {{ instanceGuid?: string | null }} [options]
 */
async function deleteKey(cacheKey, { instanceGuid = null } = {}) {
  await pool.query(
    `
      DELETE FROM genrpg.cache
      WHERE cache_key = $1
        AND instance_guid IS NOT DISTINCT FROM $2
    `,
    [cacheKey, instanceGuid],
  );

  memory.delete(memoryKey(cacheKey, instanceGuid));
}

/**
 * @param {{ instanceGuid?: string | null, keyPrefix?: string }} [options]
 * @returns {Promise<number>}
 */
async function clear({ instanceGuid, keyPrefix } = {}) {
  let result;

  if (instanceGuid !== undefined && keyPrefix !== undefined) {
    result = await pool.query(
      `
        DELETE FROM genrpg.cache
        WHERE instance_guid IS NOT DISTINCT FROM $1
          AND cache_key LIKE $2
      `,
      [instanceGuid, `${keyPrefix}%`],
    );
  } else if (instanceGuid !== undefined) {
    result = await pool.query(
      `
        DELETE FROM genrpg.cache
        WHERE instance_guid IS NOT DISTINCT FROM $1
      `,
      [instanceGuid],
    );
  } else if (keyPrefix !== undefined) {
    result = await pool.query(
      `
        DELETE FROM genrpg.cache
        WHERE cache_key LIKE $1
      `,
      [`${keyPrefix}%`],
    );
  } else {
    result = await pool.query(`DELETE FROM genrpg.cache`);
  }

  evictMemoryMatching({ instanceGuid, keyPrefix });
  return result.rowCount;
}

/**
 * @param {string} cacheKey
 * @param {() => Promise<unknown>} computeFn
 * @param {{ instanceGuid?: string | null }} [options]
 */
async function getOrCompute(cacheKey, computeFn, { instanceGuid = null } = {}) {
  const existing = await get(cacheKey, { instanceGuid });
  if (existing !== undefined) {
    return existing;
  }

  const value = await computeFn();
  await set(cacheKey, value, { instanceGuid });
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
