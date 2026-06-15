const fs = require("node:fs/promises");
const path = require("node:path");

const { packageLoadError, normalizeRelativeModulePath } = require("../lib/packageEntitiesManifest");

function assertModuleInsidePackage(packageDir, absolutePath, relativePath, label, field) {
  const relative = path.relative(packageDir, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw packageLoadError(label, `${field} path "${relativePath}" escapes the package directory`);
  }
}

function normalizeEventEntry(entry, label) {
  if (!entry || typeof entry !== "object") {
    throw packageLoadError(label, "each events entry must be an object");
  }

  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  const module = normalizeRelativeModulePath(entry.module, label, "events.module");

  if (!name) {
    throw packageLoadError(label, "each events entry requires name");
  }

  return { name, module };
}

function normalizeListenEntry(entry, label, subscriberLabel) {
  if (!entry || typeof entry !== "object") {
    throw packageLoadError(label, `${subscriberLabel} listens entry must be an object`);
  }

  const event = typeof entry.event === "string" ? entry.event.trim() : "";
  const method = typeof entry.method === "string" ? entry.method.trim() : "";
  let priority = 0;

  if (entry.priority !== undefined && entry.priority !== null) {
    priority = Number(entry.priority);
    if (!Number.isFinite(priority)) {
      throw packageLoadError(label, `${subscriberLabel} priority must be a number`);
    }
  }

  if (!event || !method) {
    throw packageLoadError(label, `${subscriberLabel} listens entry requires event and method`);
  }

  return { event, method, priority };
}

function normalizeSubscriberEntry(entry, label) {
  if (typeof entry === "string") {
    return {
      module: normalizeRelativeModulePath(entry, label, "subscribers"),
      listens: null,
    };
  }

  if (!entry || typeof entry !== "object") {
    throw packageLoadError(label, "each subscribers entry must be a string or object");
  }

  const module = normalizeRelativeModulePath(entry.module, label, "subscribers.module");

  let listens = null;
  if (entry.listens !== undefined) {
    if (!Array.isArray(entry.listens)) {
      throw packageLoadError(label, "subscribers listens must be an array");
    }

    listens = entry.listens.map((listen, index) =>
      normalizeListenEntry(listen, label, `subscribers[${index}]`),
    );
  }

  return { module, listens };
}

function normalizePackageEventsManifest(raw, label) {
  if (!raw || typeof raw !== "object") {
    throw packageLoadError(label, "manifest must be a YAML object");
  }

  const events = [];
  const subscribers = [];

  if (raw.events !== undefined) {
    if (!Array.isArray(raw.events)) {
      throw packageLoadError(label, "events must be an array");
    }
    for (const entry of raw.events) {
      events.push(normalizeEventEntry(entry, label));
    }
  }

  if (raw.subscribers !== undefined) {
    if (!Array.isArray(raw.subscribers)) {
      throw packageLoadError(label, "subscribers must be an array");
    }
    for (const entry of raw.subscribers) {
      subscribers.push(normalizeSubscriberEntry(entry, label));
    }
  }

  return { events, subscribers };
}

async function readPackageEventsManifest(packageDir, machineName) {
  const manifestPath = path.join(packageDir, `${machineName}.events.yml`);
  const label = `${machineName}.events.yml`;

  try {
    await fs.access(manifestPath);
  } catch {
    return null;
  }

  const yaml = require("yaml");
  const contents = await fs.readFile(manifestPath, "utf8");
  const raw = yaml.parse(contents);
  return normalizePackageEventsManifest(raw, label);
}

function resolvePackageModule(packageDir, relativePath, label, field) {
  const absolutePath = path.resolve(packageDir, relativePath.split("/").join(path.sep));
  assertModuleInsidePackage(packageDir, absolutePath, relativePath, label, field);
  return absolutePath;
}

module.exports = {
  readPackageEventsManifest,
  resolvePackageModule,
};
