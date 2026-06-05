const fs = require("node:fs/promises");
const path = require("node:path");

const { PackageLoadError } = require("../packages");

function normalizeRelativeModulePath(entry, label, field) {
  if (typeof entry !== "string" || !entry.trim()) {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: ${field} must be a non-empty string`,
    ]);
  }

  const normalized = entry.trim().replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalized) || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: ${field} path "${entry}" must be relative to the package root`,
    ]);
  }

  return normalized;
}

function assertModuleInsidePackage(packageDir, absolutePath, relativePath, label, field) {
  const relative = path.relative(packageDir, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: ${field} path "${relativePath}" escapes the package directory`,
    ]);
  }
}

function normalizeExtensionEntry(entry, label) {
  if (!entry || typeof entry !== "object") {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: each extensions entry must be an object`,
    ]);
  }

  const entity = typeof entry.entity === "string" ? entry.entity.trim() : "";
  const modulePath = entry.module
    ? normalizeRelativeModulePath(entry.module, label, "extensions.module")
    : "";

  if (!entity) {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: each extensions entry requires entity`,
    ]);
  }
  if (!modulePath) {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: each extensions entry requires module`,
    ]);
  }

  return { entity, module: modulePath };
}

function normalizeEntityEntry(entry, label) {
  if (!entry || typeof entry !== "object") {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: each entities entry must be an object`,
    ]);
  }

  const key = typeof entry.key === "string" ? entry.key.trim() : "";
  const modulePath = entry.module
    ? normalizeRelativeModulePath(entry.module, label, "entities.module")
    : "";

  if (!key) {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: each entities entry requires key`,
    ]);
  }
  if (!modulePath) {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: each entities entry requires module`,
    ]);
  }

  return { key, module: modulePath };
}

function normalizePackageEntitiesManifest(raw, label) {
  if (!raw || typeof raw !== "object") {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: manifest must be a YAML object`,
    ]);
  }

  const extensions = [];
  const entities = [];

  if (raw.extensions !== undefined) {
    if (!Array.isArray(raw.extensions)) {
      throw new PackageLoadError("Invalid package configuration", [
        `${label}: extensions must be an array`,
      ]);
    }
    for (const entry of raw.extensions) {
      extensions.push(normalizeExtensionEntry(entry, label));
    }
  }

  if (raw.entities !== undefined) {
    if (!Array.isArray(raw.entities)) {
      throw new PackageLoadError("Invalid package configuration", [
        `${label}: entities must be an array`,
      ]);
    }
    for (const entry of raw.entities) {
      entities.push(normalizeEntityEntry(entry, label));
    }
  }

  return { extensions, entities };
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
  readPackageEntitiesManifest,
  resolvePackageModule,
};
