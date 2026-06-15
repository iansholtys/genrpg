const path = require("node:path");

const { propertyToColumnName } = require("../packages");
const {
  readPackageEntitiesManifest,
  resolvePackageModule,
  packageLoadError,
} = require("../lib/packageEntitiesManifest");

function packageRootDir(packagePath) {
  return path.resolve(packagePath);
}

/**
 * @param {unknown} moduleExports
 * @param {string} label
 * @returns {typeof import("../entities/baseEntity").BaseEntity}
 */
function resolveEntityClass(moduleExports, label) {
  if (typeof moduleExports === "function") {
    return moduleExports;
  }

  if (moduleExports && typeof moduleExports === "object" && typeof moduleExports.default === "function") {
    return moduleExports.default;
  }

  throw new Error(`${label}: entity module must export an Entity class`);
}

/**
 * @param {typeof import("../entities/baseEntity").BaseEntity} EntityClass
 * @param {string} manifestKey
 * @param {string} packageMachineName
 * @param {string} label
 * @returns {{ schema: string, table: string, instanceScoped: boolean }}
 */
function entityDefFromEntityClass(EntityClass, manifestKey, packageMachineName, label) {
  if (!/^[a-z][a-z0-9_]*$/.test(manifestKey)) {
    throw new Error(`${label}: entity key "${manifestKey}" must be a lowercase identifier`);
  }

  const entityKey = EntityClass.key;
  if (typeof entityKey !== "string" || !entityKey.trim()) {
    throw new Error(`${label}: Entity class must define static key`);
  }
  if (entityKey !== manifestKey) {
    throw new Error(
      `${label}: manifest key "${manifestKey}" does not match Entity.key "${entityKey}"`,
    );
  }

  let StorageClass;
  try {
    StorageClass = EntityClass.getStorage();
  } catch (error) {
    throw new Error(`${label}: Entity.getStorage() failed: ${error.message}`);
  }

  if (typeof StorageClass !== "function") {
    throw new Error(`${label}: Entity.getStorage() must return a Storage class`);
  }

  const table = typeof StorageClass.table === "string" ? StorageClass.table.trim() : "";
  if (!table) {
    throw new Error(`${label}: Storage.table is required`);
  }

  return {
    schema: packageMachineName,
    table,
    instanceScoped: StorageClass.instanceScoped !== false,
  };
}

async function loadRegisteredEntities() {
  /** @type {Record<string, { schema: string, table: string, instanceScoped: boolean }>} */
  const entities = {};
  /** @type {Record<string, typeof import("../entities/baseEntity").BaseEntity>} */
  const entityClasses = {};
  /** @type {Record<string, string>} */
  const owners = {};

  function registerEntity(entityKey, EntityClass, ownerLabel, schema) {
    const def = entityDefFromEntityClass(EntityClass, entityKey, schema, ownerLabel);

    const owner = owners[entityKey];
    if (owner && owner !== ownerLabel) {
      throw new Error(`Entity "${entityKey}" is defined by both ${owner} and ${ownerLabel}`);
    }

    entities[entityKey] = def;
    entityClasses[entityKey] = EntityClass;
    owners[entityKey] = ownerLabel;
  }

  const UserEntity = resolveEntityClass(require("../entities/userEntity"), "core/userEntity");
  registerEntity("user", UserEntity, "core", "genrpg");

  const { loadPackages } = require("../packages");
  const packages = await loadPackages({ strict: false });

  for (const pkg of packages) {
    const manifest = await readPackageEntitiesManifest(pkg.path, pkg.machineName);
    if (!manifest?.entities?.length) {
      continue;
    }

    const yamlLabel = `${pkg.machineName}.entities.yml`;
    const modulesByPath = new Map();

    for (const entry of manifest.entities) {
      let moduleExports = modulesByPath.get(entry.module);
      if (!moduleExports) {
        const modulePath = resolvePackageModule(
          pkg.path,
          entry.module,
          yamlLabel,
          "entities.module",
        );
        delete require.cache[require.resolve(modulePath)];
        moduleExports = require(modulePath);
        modulesByPath.set(entry.module, moduleExports);
      }

      const moduleLabel = `${pkg.machineName}/${entry.module}`;
      const EntityClass = resolveEntityClass(moduleExports, moduleLabel);
      registerEntity(entry.key, EntityClass, pkg.machineName, pkg.machineName);
    }
  }

  return { entities, entityClasses };
}

async function loadEntitiesForPackages() {
  const { entities } = await loadRegisteredEntities();
  return entities;
}

async function loadEntityClassesByKey() {
  const { entityClasses } = await loadRegisteredEntities();
  return entityClasses;
}

/**
 * @param {string} typeName
 * @param {unknown} rawDef
 * @param {string} label
 */
function normalizeFieldTypeDefinition(typeName, rawDef, label) {
  if (!/^[a-z][a-zA-Z0-9_]*$/.test(typeName)) {
    throw new Error(`${label}: field type "${typeName}" must be a camelCase or lowercase identifier`);
  }

  if (!rawDef || typeof rawDef !== "object") {
    throw new Error(`${label}: fieldTypes.${typeName} must be an object`);
  }

  if (!Array.isArray(rawDef.columns) || !rawDef.columns.length) {
    throw new Error(`${label}: fieldTypes.${typeName} requires a non-empty columns array`);
  }

  const columns = rawDef.columns.map((column, index) => {
    if (!column || typeof column !== "object") {
      throw new Error(`${label}: fieldTypes.${typeName}.columns[${index}] must be an object`);
    }

    const name = typeof column.name === "string" ? column.name.trim() : "";
    const type = typeof column.type === "string" ? column.type.trim() : "";
    if (!name) {
      throw new Error(`${label}: fieldTypes.${typeName}.columns[${index}] requires name`);
    }
    if (!type) {
      throw new Error(`${label}: fieldTypes.${typeName}.columns[${index}] requires type`);
    }

    return {
      name,
      type,
      ...(column.nullable === false ? { nullable: false } : {}),
      ...(column.default !== undefined ? { default: String(column.default) } : {}),
      ...(column.refs ? { refs: column.refs } : {}),
    };
  });

  const defaultSortColumn = typeof rawDef.defaultSortColumn === "string"
    ? rawDef.defaultSortColumn.trim()
    : "";

  return {
    columns,
    ...(defaultSortColumn ? { defaultSortColumn } : {}),
  };
}

async function loadFieldTypesForPackages() {
  /** @type {Record<string, { columns: object[] }>} */
  const types = {};
  /** @type {Record<string, string>} */
  const owners = {};

  const { loadPackages } = require("../packages");
  const packages = await loadPackages({ strict: false });

  for (const pkg of packages) {
    const manifest = await readPackageEntitiesManifest(pkg.path, pkg.machineName);
    if (!manifest?.fieldTypes?.length) {
      continue;
    }

    const yamlLabel = `${pkg.machineName}.entities.yml`;
    const modulesByPath = new Map();

    for (const entry of manifest.fieldTypes) {
      let moduleExports = modulesByPath.get(entry.module);
      if (!moduleExports) {
        const modulePath = resolvePackageModule(
          pkg.path,
          entry.module,
          yamlLabel,
          "fieldTypes.module",
        );
        delete require.cache[require.resolve(modulePath)];
        moduleExports = require(modulePath);
        modulesByPath.set(entry.module, moduleExports);
      }

      const moduleLabel = `${pkg.machineName}/${entry.module}`;
      const rawFieldTypes = moduleExports?.fieldTypes;
      if (!rawFieldTypes || typeof rawFieldTypes !== "object" || Array.isArray(rawFieldTypes)) {
        throw new Error(`${moduleLabel}: field type module must export a fieldTypes object`);
      }

      for (const [typeName, rawDef] of Object.entries(rawFieldTypes)) {
        const owner = owners[typeName];
        if (owner && owner !== pkg.machineName) {
          throw new Error(
            `Field type "${typeName}" is defined by both ${owner} and ${pkg.machineName}`,
          );
        }

        types[typeName] = normalizeFieldTypeDefinition(typeName, rawDef, moduleLabel);
        owners[typeName] = pkg.machineName;
      }
    }
  }

  return types;
}

/**
 * @param {string} property camelCase property on the entity
 * @param {object} rawSpec from a field declaration module
 * @param {{ entityKey: string, label: string }} context
 */
function normalizeCoreFieldSpec(property, rawSpec, context) {
  const { entityKey, label: contextLabel } = context;

  if (!rawSpec || typeof rawSpec !== "object") {
    throw new Error(`${contextLabel}: coreFields.${property} must be an object`);
  }

  const column = typeof rawSpec.column === "string" && rawSpec.column.trim()
    ? rawSpec.column.trim()
    : propertyToColumnName(property);

  return {
    property,
    column,
    entityKey,
    createOnly: !!rawSpec.createOnly,
    public: !!rawSpec.public,
    label:
      typeof rawSpec.label === "string" && rawSpec.label.trim()
        ? rawSpec.label.trim()
        : property.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
  };
}

/**
 * @param {string} property camelCase field key on the entity
 * @param {object} rawSpec from a field declaration module
 * @param {{ entityKey: string, schema: string, label: string, fieldTypes: Record<string, { columns: object[] }>, entities: Record<string, { schema: string, table: string, instanceScoped: boolean }> }} context
 */
function normalizeFieldSpec(property, rawSpec, context) {
  const { entityKey, schema, label: contextLabel, fieldTypes, entities } = context;

  if (!rawSpec || typeof rawSpec !== "object") {
    throw new Error(`${contextLabel}: fields.${property} must be an object`);
  }

  const type = typeof rawSpec.type === "string" ? rawSpec.type.trim() : "";
  if (!Object.hasOwn(fieldTypes, type)) {
    throw new Error(
      `${contextLabel}: fields.${property}.type must be one of: ${Object.keys(fieldTypes).join(", ")}`,
    );
  }

  let cardinality = rawSpec.cardinality ?? 1;
  if (cardinality < 1) {
    cardinality = 0;
  }

  let refs;
  if (type === "entityRef") {
    refs = typeof rawSpec.refs === "string" ? rawSpec.refs.trim() : "";
    if (!refs) {
      throw new Error(`${contextLabel}: fields.${property} (entityRef) requires refs`);
    }
    if (!Object.hasOwn(entities, refs)) {
      throw new Error(
        `${contextLabel}: fields.${property}.refs "${refs}" is not a registered entity. Registered entities: ${Object.keys(entities).join(", ")}`,
      );
    }
  }

  const entityDef = entities[entityKey];
  if (!entityDef) {
    throw new Error(
      `Unknown entity key "${entityKey}". Registered entities: ${Object.keys(entities).join(", ")}`,
    );
  }
  const fieldColumn = propertyToColumnName(property);
  const table = `${entityKey}_${fieldColumn}`;

  return {
    property,
    type,
    cardinality,
    schema,
    entityKey,
    entitySchema: entityDef.schema,
    entityTable: entityDef.table,
    table,
    column: fieldColumn,
    label:
      typeof rawSpec.label === "string" && rawSpec.label.trim()
        ? rawSpec.label.trim()
        : property.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
    required: !!rawSpec.required,
    ...(refs ? { refs } : {}),
    ...(rawSpec.default !== undefined ? { default: rawSpec.default } : {}),
    ...(rawSpec.inputType ? { inputType: rawSpec.inputType } : {}),
    fieldType: fieldTypes[type],
  };
}

function isSpecObject(raw) {
  return raw && typeof raw === "object" && !Array.isArray(raw);
}

/**
 * @param {Record<string, Record<string, object>>} target
 * @param {string} entityKey
 * @param {Record<string, object> | null | undefined} rawSpecs
 * @param {{ yamlLabel: string, duplicateLabel: string, normalize: (property: string, rawSpec: object) => object }} options
 */
function addNormalizedSpecs(target, entityKey, rawSpecs, { yamlLabel, duplicateLabel, normalize }) {
  if (!rawSpecs) {
    return;
  }

  if (!target[entityKey]) {
    target[entityKey] = {};
  }

  for (const [property, rawSpec] of Object.entries(rawSpecs)) {
    if (target[entityKey][property]) {
      throw packageLoadError(
        yamlLabel,
        `duplicate ${duplicateLabel} "${property}" on entity "${entityKey}"`,
      );
    }

    target[entityKey][property] = normalize(property, rawSpec);
  }
}

/**
 * @param {Record<string, Record<string, object>>} target
 * @param {Record<string, Record<string, object>>} source
 * @param {Map<string, string>} owners
 * @param {string} pkgMachineName
 * @param {string} specLabel e.g. "Field" or "Core field"
 */
function mergeSpecsByEntity(target, source, owners, pkgMachineName, specLabel) {
  for (const [entityKey, fields] of Object.entries(source)) {
    if (!target[entityKey]) {
      target[entityKey] = {};
    }

    for (const [property, spec] of Object.entries(fields)) {
      const ownerKey = `${entityKey}.${property}`;
      if (owners.has(ownerKey)) {
        throw packageLoadError(
          null,
          `${specLabel} "${property}" on entity "${entityKey}" is defined by both ${owners.get(ownerKey)} and ${pkgMachineName}`,
        );
      }

      owners.set(ownerKey, pkgMachineName);
      target[entityKey][property] = spec;
    }
  }
}

/**
 * Load normalized field and core-field specs from one package manifest.
 * @returns {{ specsByEntity: Record<string, Record<string, object>>, coreSpecsByEntity: Record<string, Record<string, object>> }}
 */
async function loadPackageFieldSpecs(pkg, fieldTypes, entities) {
  const packageDir = packageRootDir(pkg.path);
  const manifest = await readPackageEntitiesManifest(packageDir, pkg.machineName);
  if (!manifest?.fields?.length) {
    return { specsByEntity: {}, coreSpecsByEntity: {} };
  }

  const yamlLabel = `${pkg.machineName}.entities.yml`;
  const modulesByPath = new Map();
  const specsByEntity = {};
  const coreSpecsByEntity = {};

  for (const entry of manifest.fields) {
    if (!/^[a-z][a-z0-9_]*$/.test(entry.entity)) {
      throw packageLoadError(yamlLabel, `fields entity "${entry.entity}" must be a lowercase identifier`);
    }

    let moduleExports = modulesByPath.get(entry.module);
    if (!moduleExports) {
      const modulePath = resolvePackageModule(
        packageDir,
        entry.module,
        yamlLabel,
        "fields.module",
      );
      delete require.cache[require.resolve(modulePath)];
      moduleExports = require(modulePath);
      modulesByPath.set(entry.module, moduleExports);
    }

    const moduleLabel = `${pkg.machineName}/${entry.module}`;
    const rawFields = isSpecObject(moduleExports?.fields) ? moduleExports.fields : null;
    const rawCoreFields = isSpecObject(moduleExports?.coreFields) ? moduleExports.coreFields : null;

    if (!rawFields && !rawCoreFields) {
      throw new Error(`${moduleLabel}: field module must export a fields and/or coreFields object`);
    }

    const fieldContext = {
      entityKey: entry.entity,
      schema: pkg.machineName,
      label: moduleLabel,
      fieldTypes,
      entities,
    };
    const coreContext = {
      entityKey: entry.entity,
      label: moduleLabel,
    };

    addNormalizedSpecs(specsByEntity, entry.entity, rawFields, {
      yamlLabel,
      duplicateLabel: "field",
      normalize: (property, rawSpec) => normalizeFieldSpec(property, rawSpec, fieldContext),
    });
    addNormalizedSpecs(coreSpecsByEntity, entry.entity, rawCoreFields, {
      yamlLabel,
      duplicateLabel: "core field",
      normalize: (property, rawSpec) => normalizeCoreFieldSpec(property, rawSpec, coreContext),
    });
  }

  return { specsByEntity, coreSpecsByEntity };
}

async function loadMergedFieldAndCoreSpecs(packageNames = null) {
  const entities = await loadEntitiesForPackages();
  const fieldTypes = await loadFieldTypesForPackages();

  const { loadPackages } = require("../packages");
  const packages = await loadPackages({ strict: false, packageNames });
  const merged = {};
  const mergedCore = {};
  const propertyOwners = new Map();
  const corePropertyOwners = new Map();

  for (const pkg of packages) {
    const { specsByEntity, coreSpecsByEntity } = await loadPackageFieldSpecs(pkg, fieldTypes, entities);

    mergeSpecsByEntity(merged, specsByEntity, propertyOwners, pkg.machineName, "Field");
    mergeSpecsByEntity(mergedCore, coreSpecsByEntity, corePropertyOwners, pkg.machineName, "Core field");
  }

  return { fields: merged, coreFields: mergedCore };
}

/**
 * Merge field specs across packages. Later packages cannot override an existing property.
 * @param {string[] | null} [packageNames] limit to these machine names; default all packages
 * @returns {Promise<Record<string, Record<string, object>>>}
 */
async function loadMergedFieldSpecs(packageNames = null) {
  const { fields } = await loadMergedFieldAndCoreSpecs(packageNames);
  return fields;
}

/**
 * Merge core-field specs across packages.
 * @param {string[] | null} [packageNames] limit to these machine names; default all packages
 * @returns {Promise<Record<string, Record<string, object>>>}
 */
async function loadMergedCoreFieldSpecs(packageNames = null) {
  const { coreFields } = await loadMergedFieldAndCoreSpecs(packageNames);
  return coreFields;
}

/**
 * Flat list of all field specs from installed packages.
 * @param {string[] | null} [packageNames] limit to these machine names; default all packages
 * @returns {Promise<object[]>}
 */
async function loadAllFieldSpecs(packageNames = null) {
  const merged = await loadMergedFieldSpecs(packageNames);
  const specs = [];
  for (const fields of Object.values(merged)) {
    for (const spec of Object.values(fields)) {
      specs.push(spec);
    }
  }
  return specs.sort((left, right) => {
    const leftKey = `${left.schema}.${left.table}`;
    const rightKey = `${right.schema}.${right.table}`;
    return leftKey.localeCompare(rightKey);
  });
}

module.exports = {
  loadAllFieldSpecs,
  loadMergedFieldSpecs,
  loadMergedCoreFieldSpecs,
  loadEntityClassesByKey,
};
