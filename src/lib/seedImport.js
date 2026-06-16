const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * @param {unknown} value
 * @returns {string | null} stable string key for dedupe/refs, or null when empty
 */
function naturalKey(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return String(value).trim() || null;
}

/**
 * @param {string} entityKey
 * @param {string} name
 * @returns {string}
 */
function refKey(entityKey, name) {
  return `${entityKey}:${name}`;
}

function createInstallRefRegistry() {
  /** @type {Map<string, string>} */
  const refs = new Map();

  return {
    refs,
    /**
     * @param {string} entityKey
     * @param {unknown} name
     * @param {string} guid
     */
    registerRef(entityKey, name, guid) {
      const key = naturalKey(name);
      if (key) {
        refs.set(refKey(entityKey, key), guid);
      }
    },
    /**
     * @param {string} entityKey
     * @param {unknown} name
     * @returns {string}
     */
    resolveRef(entityKey, name) {
      const key = naturalKey(name);
      if (!key) {
        throw new Error(`Unresolved seed reference "${entityKey}:" (empty key)`);
      }
      const guid = refs.get(refKey(entityKey, key));
      if (!guid) {
        throw new Error(`Unresolved seed reference "${refKey(entityKey, key)}"`);
      }
      return guid;
    },
  };
}

/**
 * @param {string} packageDir absolute package root
 * @param {string} relativePath path relative to package root
 * @returns {Promise<object[]>}
 */
async function loadSeedJson(packageDir, relativePath) {
  const filePath = path.join(packageDir, relativePath);
  const raw = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error(`Seed file "${relativePath}" must contain a JSON array`);
  }

  return data;
}

/**
 * Import entity-shaped records through storage. Skips rows that already exist by natural key.
 *
 * Entity key and name field default from {@link import("../storage/baseStorage").BaseStorage#entityClass}:
 * `Entity.key` and `Entity.labelProperties[0]`.
 *
 * @param {import("../storage/baseStorage").BaseStorage} storage
 * @param {object[]} records
 * @param {{
 *   entityKey?: string,
 *   nameField?: string,
 *   skipExisting?: boolean,
 *   resolveRecord?: (record: object) => object,
 *   refs?: ReturnType<typeof createInstallRefRegistry>,
 * }} [options]
 */
async function importJsonEntities(storage, records, options = {}) {
  const Entity = storage.entityClass;
  if (!Entity?.key) {
    throw new Error("importJsonEntities requires storage bound to an Entity with static key");
  }

  const entityKey = options.entityKey ?? Entity.key;
  const nameField = options.nameField ?? Entity.labelProperties?.[0];
  if (!nameField) {
    throw new Error(
      `${Entity.name} has no labelProperties; pass nameField to importJsonEntities`,
    );
  }

  const {
    skipExisting = true,
    resolveRecord,
    refs,
  } = options;

  /** @type {{ entity: import("../entities/baseEntity").BaseEntity, created: boolean }[]} */
  const results = [];

  for (const record of records) {
    const key = naturalKey(record[nameField]);

    if (skipExisting && key) {
      const existing = await storage.listEntities({ [nameField]: key });
      if (existing.length > 0) {
        const entity = existing[0];
        refs?.registerRef(entityKey, key, entity.guid);
        results.push({ entity, created: false });
        continue;
      }
    }

    const entity = await storage.create();
    const values = resolveRecord ? resolveRecord(record) : { ...record };
    entity.set(values);

    const errors = await entity.validate();
    if (errors.length) {
      throw new Error(
        `Seed validation failed for ${entityKey} "${key ?? "?"}": ${errors.join("; ")}`,
      );
    }

    await entity.save({ skipEvents: true });

    if (key) {
      refs?.registerRef(entityKey, key, entity.guid);
    }

    results.push({ entity, created: true });
  }

  return results;
}

module.exports = {
  createInstallRefRegistry,
  loadSeedJson,
  importJsonEntities,
};
