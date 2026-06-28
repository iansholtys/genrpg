const fs = require("node:fs/promises");
const path = require("node:path");

const { packageLoadError, normalizeRelativeModulePath } = require("../lib/packageEntitiesManifest");
const { trimmedString } = require("../lib/strings");

function assertModuleInsidePackage(packageDir, absolutePath, relativePath, manifestFileName, field) {
  const relative = path.relative(packageDir, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw packageLoadError(manifestFileName, `${field} path "${relativePath}" escapes the package directory`);
  }
}

function normalizeEventEntry(entry, manifestFileName) {
  if (!entry || typeof entry !== "object") {
    throw packageLoadError(manifestFileName, "each events entry must be an object");
  }

  const name = trimmedString(entry.name);
  const module = normalizeRelativeModulePath(entry.module, manifestFileName, "events.module");

  if (!name) {
    throw packageLoadError(manifestFileName, "each events entry requires name");
  }

  return { name, module };
}

function normalizeListenEntry(entry, manifestFileName, subscriberLabel) {
  if (!entry || typeof entry !== "object") {
    throw packageLoadError(manifestFileName, `${subscriberLabel} listens entry must be an object`);
  }

  const event = trimmedString(entry.event);
  const method = trimmedString(entry.method);
  let priority = 0;

  if (entry.priority !== undefined && entry.priority !== null) {
    priority = Number(entry.priority);
    if (!Number.isFinite(priority)) {
      throw packageLoadError(manifestFileName, `${subscriberLabel} priority must be a number`);
    }
  }

  if (!event || !method) {
    throw packageLoadError(manifestFileName, `${subscriberLabel} listens entry requires event and method`);
  }

  return { event, method, priority };
}

function normalizeSubscriberEntry(entry, manifestFileName) {
  if (typeof entry === "string") {
    return {
      module: normalizeRelativeModulePath(entry, manifestFileName, "subscribers"),
      listens: null,
    };
  }

  if (!entry || typeof entry !== "object") {
    throw packageLoadError(manifestFileName, "each subscribers entry must be a string or object");
  }

  const module = normalizeRelativeModulePath(entry.module, manifestFileName, "subscribers.module");

  let listens = null;
  if (entry.listens !== undefined) {
    if (!Array.isArray(entry.listens)) {
      throw packageLoadError(manifestFileName, "subscribers listens must be an array");
    }

    listens = entry.listens.map((listen, index) =>
      normalizeListenEntry(listen, manifestFileName, `subscribers[${index}]`),
    );
  }

  return { module, listens };
}

function normalizePackageEventsManifest(raw, manifestFileName) {
  if (!raw || typeof raw !== "object") {
    throw packageLoadError(manifestFileName, "manifest must be a YAML object");
  }

  const events = [];
  const subscribers = [];

  if (raw.events !== undefined) {
    if (!Array.isArray(raw.events)) {
      throw packageLoadError(manifestFileName, "events must be an array");
    }
    for (const entry of raw.events) {
      events.push(normalizeEventEntry(entry, manifestFileName));
    }
  }

  if (raw.subscribers !== undefined) {
    if (!Array.isArray(raw.subscribers)) {
      throw packageLoadError(manifestFileName, "subscribers must be an array");
    }
    for (const entry of raw.subscribers) {
      subscribers.push(normalizeSubscriberEntry(entry, manifestFileName));
    }
  }

  return { events, subscribers };
}

async function readPackageEventsManifest(packageDir, manifestFileName) {
  const manifestPath = path.join(packageDir, manifestFileName);

  try {
    await fs.access(manifestPath);
  } catch {
    return null;
  }

  const yaml = require("yaml");
  const contents = await fs.readFile(manifestPath, "utf8");
  const raw = yaml.parse(contents);
  return normalizePackageEventsManifest(raw, manifestFileName);
}

function resolvePackageModule(packageDir, relativePath, manifestFileName, field) {
  const absolutePath = path.resolve(packageDir, relativePath.split("/").join(path.sep));
  assertModuleInsidePackage(packageDir, absolutePath, relativePath, manifestFileName, field);
  return absolutePath;
}

module.exports = {
  readPackageEventsManifest,
  resolvePackageModule,
};
