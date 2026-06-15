const fs = require("node:fs/promises");
const path = require("node:path");

function packageLoadError(label, message) {
  const { PackageLoadError } = require("../packages");
  const detail = label ? `${label}: ${message}` : message;
  return new PackageLoadError("Invalid package configuration", [detail]);
}

function normalizeRelativeModulePath(entry, label, field) {
  if (entry === undefined || entry === null) {
    throw packageLoadError(label, `${field} is required`);
  }
  if (typeof entry !== "string" || !entry.trim()) {
    throw packageLoadError(label, `${field} must be a non-empty string`);
  }

  const normalized = entry.trim().replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalized) || normalized.startsWith("../") || normalized.includes("/../")) {
    throw packageLoadError(label, `${field} path "${entry}" must be relative to the package root`);
  }

  return normalized;
}

function assertModuleInsidePackage(packageDir, absolutePath, relativePath, label, field) {
  const relative = path.relative(packageDir, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw packageLoadError(label, `${field} path "${relativePath}" escapes the package directory`);
  }
}

function normalizeEntityEntry(entry, label) {
  if (!entry || typeof entry !== "object") {
    throw packageLoadError(label, "each entities entry must be an object");
  }

  const key = typeof entry.key === "string" ? entry.key.trim() : "";
  const module = normalizeRelativeModulePath(entry.module, label, "entities.module");

  if (!key) {
    throw packageLoadError(label, "each entities entry requires key");
  }

  return { key, module };
}

function normalizePackageEntitiesManifest(raw, label) {
  if (!raw || typeof raw !== "object") {
    throw packageLoadError(label, "manifest must be a YAML object");
  }

  const fields = [];
  const fieldTypes = [];
  const entities = [];

  if (raw.fieldTypes !== undefined) {
    if (!Array.isArray(raw.fieldTypes)) {
      throw packageLoadError(label, "fieldTypes must be an array");
    }
    for (const entry of raw.fieldTypes) {
      if (!entry || typeof entry !== "object") {
        throw packageLoadError(label, "each fieldTypes entry must be an object");
      }

      fieldTypes.push({
        module: normalizeRelativeModulePath(entry.module, label, "fieldTypes.module"),
      });
    }
  }

  if (raw.fields !== undefined) {
    if (!Array.isArray(raw.fields)) {
      throw packageLoadError(label, "fields must be an array");
    }
    for (const entry of raw.fields) {
      if (!entry || typeof entry !== "object") {
        throw packageLoadError(label, "each fields entry must be an object");
      }

      const entity = typeof entry.entity === "string" ? entry.entity.trim() : "";
      const module = normalizeRelativeModulePath(entry.module, label, "fields.module");

      if (!entity) {
        throw packageLoadError(label, "each fields entry requires entity");
      }

      fields.push({ entity, module });
    }
  }

  if (raw.entities !== undefined) {
    if (!Array.isArray(raw.entities)) {
      throw packageLoadError(label, "entities must be an array");
    }
    for (const entry of raw.entities) {
      entities.push(normalizeEntityEntry(entry, label));
    }
  }

  return { fields, fieldTypes, entities };
}

async function readPackageEntitiesManifest(packageDir, machineName) {
  const manifestPath = path.join(packageDir, `${machineName}.entities.yml`);
  const label = `${machineName}.entities.yml`;

  try {
    await fs.access(manifestPath);
  } catch {
    return null;
  }

  const yaml = require("yaml");
  const contents = await fs.readFile(manifestPath, "utf8");
  const raw = yaml.parse(contents);
  return normalizePackageEntitiesManifest(raw, label);
}

function resolvePackageModule(packageDir, relativePath, label, field) {
  const absolutePath = path.resolve(packageDir, relativePath.split("/").join(path.sep));
  assertModuleInsidePackage(packageDir, absolutePath, relativePath, label, field);
  return absolutePath;
}

module.exports = {
  packageLoadError,
  normalizeRelativeModulePath,
  readPackageEntitiesManifest,
  resolvePackageModule,
};
