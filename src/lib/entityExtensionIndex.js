const path = require("node:path");

const { PackageLoadError, packageRootDir } = require("../packages");
const {
  readPackageEntitiesManifest,
  resolvePackageModule,
} = require("./packageEntitiesManifest");

const VALID_FIELD_TYPES = new Set(["text", "guid", "number", "integer", "boolean"]);
const ENTITY_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/** @type {Map<string, Map<string, Record<string, object>>>} entityKey -> machineName -> property -> spec */
let extensionIndex = null;

function propertyToColumnName(property) {
  return property.replace(/([A-Z])/g, (_, char) => `_${char.toLowerCase()}`);
}

function normalizeFieldSpec(property, rawSpec, machineName, label) {
  if (!rawSpec || typeof rawSpec !== "object") {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: fields.${property} must be an object`,
    ]);
  }

  const type = typeof rawSpec.type === "string" ? rawSpec.type.trim() : "";
  if (!VALID_FIELD_TYPES.has(type)) {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: fields.${property}.type must be one of: ${[...VALID_FIELD_TYPES].join(", ")}`,
    ]);
  }

  if (type === "guid" && !rawSpec.refs) {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: fields.${property} (guid) requires refs`,
    ]);
  }

  const column =
    typeof rawSpec.column === "string" && rawSpec.column.trim()
      ? rawSpec.column.trim()
      : propertyToColumnName(property);

  return {
    property,
    schema: machineName,
    column,
    label:
      typeof rawSpec.label === "string" && rawSpec.label.trim()
        ? rawSpec.label.trim()
        : property.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
    type,
    required: !!rawSpec.required,
    extension: true,
    ...(rawSpec.refs ? { refs: rawSpec.refs } : {}),
    ...(rawSpec.default !== undefined ? { default: rawSpec.default } : {}),
    ...(rawSpec.inputType ? { inputType: rawSpec.inputType } : {}),
  };
}

function validateExtensionModule(moduleExports, label) {
  const fields = moduleExports?.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: extension module must export a fields object`,
    ]);
  }
  return fields;
}

async function refreshEntityExtensionIndex(packages) {
  const nextIndex = new Map();

  for (const pkg of packages) {
    const packageDir = packageRootDir(pkg.path);
    const manifest = await readPackageEntitiesManifest(packageDir, pkg.machineName);
    if (!manifest || !manifest.extensions.length) {
      continue;
    }

    const yamlLabel = `${pkg.machineName}.entities.yml`;
    const modulesByPath = new Map();

    for (const entry of manifest.extensions) {
      if (!ENTITY_KEY_PATTERN.test(entry.entity)) {
        throw new PackageLoadError("Invalid package configuration", [
          `${yamlLabel}: extensions entity "${entry.entity}" must be a lowercase identifier`,
        ]);
      }

      let moduleExports = modulesByPath.get(entry.module);
      if (!moduleExports) {
        const modulePath = resolvePackageModule(
          packageDir,
          entry.module,
          yamlLabel,
          "extensions.module",
        );
        delete require.cache[require.resolve(modulePath)];
        moduleExports = require(modulePath);
        modulesByPath.set(entry.module, moduleExports);
      }

      const moduleLabel = `${pkg.machineName}/${entry.module}`;
      const rawFields = validateExtensionModule(moduleExports, moduleLabel);

      if (!nextIndex.has(entry.entity)) {
        nextIndex.set(entry.entity, new Map());
      }
      const byPackage = nextIndex.get(entry.entity);
      const specs = {};

      for (const [property, rawSpec] of Object.entries(rawFields)) {
        specs[property] = normalizeFieldSpec(property, rawSpec, pkg.machineName, moduleLabel);
      }

      byPackage.set(pkg.machineName, specs);
    }
  }

  extensionIndex = nextIndex;
}

function invalidateEntityExtensionIndex() {
  extensionIndex = null;
}

function getExtensionIndex() {
  return extensionIndex || new Map();
}

/**
 * Merge extension field specs for an entity and instance package set (in-memory only).
 * @returns {Record<string, object>}
 */
function mergeExtensionFieldSpecs(entityKey, packageNames, coreFieldKeys = []) {
  const byPackage = getExtensionIndex().get(entityKey);
  if (!byPackage) {
    return {};
  }

  const packageSet = new Set(packageNames);
  const coreKeys = new Set(coreFieldKeys);
  const specs = {};
  const propertyOwners = new Map();

  for (const [machineName, packageSpecs] of byPackage) {
    if (!packageSet.has(machineName)) {
      continue;
    }

    for (const [property, spec] of Object.entries(packageSpecs)) {
      if (coreKeys.has(property)) {
        continue;
      }

      if (propertyOwners.has(property)) {
        throw new Error(
          `Extension field "${property}" is defined by both ${propertyOwners.get(property)} and ${machineName}`,
        );
      }

      propertyOwners.set(property, machineName);
      specs[property] = spec;
    }
  }

  return specs;
}

module.exports = {
  refreshEntityExtensionIndex,
  invalidateEntityExtensionIndex,
  mergeExtensionFieldSpecs,
};
