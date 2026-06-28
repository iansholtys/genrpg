const path = require("node:path");

const { PackageLoadError } = require("../errors/PackageLoadError");
const { trimmedString } = require("./strings");
const { readOptionalYamlFile } = require("./yamlFile");

function packageLoadError(manifestFileName, message) {
  const detail = manifestFileName ? `${manifestFileName}: ${message}` : message;
  return new PackageLoadError("Invalid package configuration", [detail]);
}

function normalizeRelativeModulePath(entry, manifestFileName, field) {
  if (entry === undefined || entry === null) {
    throw packageLoadError(manifestFileName, `${field} is required`);
  }
  const trimmed = trimmedString(entry);
  if (!trimmed) {
    throw packageLoadError(manifestFileName, `${field} must be a non-empty string`);
  }

  const normalized = trimmed.replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalized) || normalized.startsWith("../") || normalized.includes("/../")) {
    throw packageLoadError(manifestFileName, `${field} path "${entry}" must be relative to the package root`);
  }

  return normalized;
}

function assertModuleInsidePackage(packageDir, absolutePath, relativePath, manifestFileName, field) {
  const relative = path.relative(packageDir, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw packageLoadError(manifestFileName, `${field} path "${relativePath}" escapes the package directory`);
  }
}

function normalizeEntityEntry(entry, manifestFileName) {
  if (!entry || typeof entry !== "object") {
    throw packageLoadError(manifestFileName, "each entities entry must be an object");
  }

  const key = trimmedString(entry.key);
  const module = normalizeRelativeModulePath(entry.module, manifestFileName, "entities.module");

  if (!key) {
    throw packageLoadError(manifestFileName, "each entities entry requires key");
  }

  return { key, module };
}

function normalizePackageEntitiesManifest(raw, manifestFileName) {
  if (!raw || typeof raw !== "object") {
    throw packageLoadError(manifestFileName, "manifest must be a YAML object");
  }

  const fields = [];
  const fieldTypes = [];
  const entities = [];

  if (raw.fieldTypes !== undefined) {
    if (!Array.isArray(raw.fieldTypes)) {
      throw packageLoadError(manifestFileName, "fieldTypes must be an array");
    }
    for (const entry of raw.fieldTypes) {
      if (!entry || typeof entry !== "object") {
        throw packageLoadError(manifestFileName, "each fieldTypes entry must be an object");
      }

      fieldTypes.push({
        module: normalizeRelativeModulePath(entry.module, manifestFileName, "fieldTypes.module"),
      });
    }
  }

  if (raw.fields !== undefined) {
    if (!Array.isArray(raw.fields)) {
      throw packageLoadError(manifestFileName, "fields must be an array");
    }
    for (const entry of raw.fields) {
      if (!entry || typeof entry !== "object") {
        throw packageLoadError(manifestFileName, "each fields entry must be an object");
      }

      const entity = trimmedString(entry.entity);
      const module = normalizeRelativeModulePath(entry.module, manifestFileName, "fields.module");

      if (!entity) {
        throw packageLoadError(manifestFileName, "each fields entry requires entity");
      }

      fields.push({ entity, module });
    }
  }

  if (raw.entities !== undefined) {
    if (!Array.isArray(raw.entities)) {
      throw packageLoadError(manifestFileName, "entities must be an array");
    }
    for (const entry of raw.entities) {
      entities.push(normalizeEntityEntry(entry, manifestFileName));
    }
  }

  return { fields, fieldTypes, entities };
}

async function readPackageEntitiesManifest(packageDir, manifestFileName) {
  const manifestPath = path.join(packageDir, manifestFileName);
  const raw = await readOptionalYamlFile(manifestPath);
  if (!raw) {
    return null;
  }
  return normalizePackageEntitiesManifest(raw, manifestFileName);
}

function resolvePackageModule(packageDir, relativePath, manifestFileName, field) {
  const absolutePath = path.resolve(packageDir, relativePath.split("/").join(path.sep));
  assertModuleInsidePackage(packageDir, absolutePath, relativePath, manifestFileName, field);
  return absolutePath;
}

module.exports = {
  packageLoadError,
  normalizeRelativeModulePath,
  readPackageEntitiesManifest,
  resolvePackageModule,
};
