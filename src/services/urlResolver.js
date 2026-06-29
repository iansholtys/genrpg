/**
 * URL alias resolution and instance alias lifecycle.
 *
 * Public URLs use aliases (e.g. instance/my-game). The database stores an internal
 * path per alias (e.g. instance:<uuid>). {@link lookupAlias} bridges the public
 * form; {@link resolvePath} handles the internal form when the path is already known.
 */
const UrlAliasStorage = require("../../genrpg/storage/urlAliasStorage");
const { normalizeAlias } = require("../../genrpg/entities/urlAlias");
const { ValidationError } = require("../errors/ValidationError");
const {
  loadAccessibleInstance,
  userHasPermission,
} = require("./permissionService");

function aliasStorage() {
  return UrlAliasStorage.global();
}

function instancePath(instanceGuid) {
  return `instance:${instanceGuid}`;
}

function defaultInstanceAlias(instanceGuid) {
  return `instance/${instanceGuid}`;
}

/** Slugify user input for the part after instance/ in a public URL. */
function slugifyInstance(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Alias row for a public path, or null when not registered. */
async function lookupAlias(alias) {
  const entity = await aliasStorage().loadByAlias(alias, { skipEvents: true });
  if (!entity) {
    return null;
  }

  return {
    guid: entity.guid,
    alias: entity.alias,
    path: entity.path,
  };
}

/** Canonical public alias for an internal path, or null. */
async function canonicalAliasForPath(path) {
  if (!path) {
    return null;
  }

  const [entity] = await aliasStorage().list({
    path,
    isCanonical: true,
    skipEvents: true,
  });
  return entity?.alias ?? null;
}

/** Custom slug from the canonical alias, or "" when using the default guid-based URL. */
async function customSlugsForInstances(instanceGuids) {
  const slugByPath = new Map();
  if (!instanceGuids.length) {
    return slugByPath;
  }

  const aliases = await aliasStorage().list({
    path: instanceGuids.map(instancePath),
    isCanonical: true,
    skipEvents: true,
  });

  for (const { path, alias } of aliases) {
    const guid = /^instance:(.+)$/.exec(path)?.[1];
    if (!guid) {
      continue;
    }
    const defaultAlias = defaultInstanceAlias(guid);
    if (!alias || alias === defaultAlias || !alias.startsWith("instance/")) {
      continue;
    }
    const slug = alias.slice("instance/".length);
    if (!slug || slug === guid) {
      continue;
    }
    slugByPath.set(path, slug);
  }

  return slugByPath;
}

async function customSlugForInstance(instanceGuid) {
  const slugs = await customSlugsForInstances([instanceGuid]);
  return slugs.get(instancePath(instanceGuid)) ?? "";
}

/**
 * Create or promote a custom canonical alias (instance/<slug>) for an instance.
 * @returns {Promise<string|null>} The saved alias, or null when slug is empty.
 */
async function createCustomInstanceAlias(instanceGuid, slug) {
  if (!slug) {
    return null;
  }

  const storage = aliasStorage();
  const path = instancePath(instanceGuid);
  const alias = normalizeAlias(`instance/${slug}`);
  const existing = await storage.loadByAlias(alias, { skipEvents: true });
  if (existing?.path === path) {
    await storage.setCanonical(existing);
    return existing.alias;
  }

  const entity = await storage.create();
  entity.set({ alias, path });
  const validationErrors = await entity.validate();
  if (validationErrors.length) {
    throw new ValidationError(validationErrors);
  }

  await entity.save({ skipEvents: true });
  await storage.setCanonical(entity);
  return entity.alias;
}

/** Default alias rows for a new instance; optional slug adds a custom canonical alias. */
async function createInstanceAliases(instanceGuid, slug) {
  const storage = aliasStorage();
  const entity = await storage.create();
  entity.set({
    alias: defaultInstanceAlias(instanceGuid),
    path: instancePath(instanceGuid),
  });
  const validationErrors = await entity.validate();
  if (validationErrors.length) {
    throw new ValidationError(validationErrors);
  }
  await entity.save({ skipEvents: true });
  await storage.setCanonical(entity);
  if (slug) {
    await createCustomInstanceAlias(instanceGuid, slug);
  }
}

/**
 * Update instance slug on edit.
 * Empty slug removes customs and restores the guid-based default as canonical.
 */
async function setInstanceSlug(instanceGuid, slug) {
  const storage = aliasStorage();
  const path = instancePath(instanceGuid);
  const defaultAlias = defaultInstanceAlias(instanceGuid);
  const aliases = await storage.list({ path, skipEvents: true });

  for (const entity of aliases) {
    if (entity.alias !== defaultAlias) {
      await storage.delete(entity.guid);
    }
  }

  if (!slug) {
    const defaultEntity = await storage.loadByAlias(defaultAlias, { skipEvents: true });
    if (defaultEntity) {
      await storage.setCanonical(defaultEntity);
    }
    return;
  }

  await createCustomInstanceAlias(instanceGuid, slug);
}

/** Delete all alias rows for an instance. */
async function deleteInstanceAliases(instanceGuid) {
  const storage = aliasStorage();
  const aliases = await storage.list({ path: instancePath(instanceGuid), skipEvents: true });

  for (const entity of aliases) {
    await storage.delete(entity.guid);
  }
}

/**
 * Resolve internal path (instance:<guid>) to a client route target when the user may run it.
 * Returns null when unknown, inaccessible, or lacking permission.
 */
async function resolvePath(path, user) {
  if (!path || typeof path !== "string") {
    return null;
  }

  const separatorIndex = path.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === path.length - 1) {
    return null;
  }

  const type = path.slice(0, separatorIndex);
  const payload = path.slice(separatorIndex + 1);

  if (type !== "instance") {
    return null;
  }

  const instance = await loadAccessibleInstance(payload, user);
  if (!instance) {
    return null;
  }

  const canRun = await userHasPermission(user.guid, payload, "instance.run");
  if (!canRun) {
    return null;
  }

  return {
    type: "instance",
    guid: instance.guid,
    name: instance.name,
  };
}

/** Resolve a browser pathname (public alias URL) to a client route target for the SPA shell. */
async function resolveRequestPath(pathname, user) {
  const alias = normalizeAlias(pathname);
  if (!alias) {
    return null;
  }

  const aliasInfo = await lookupAlias(alias);
  if (!aliasInfo) {
    return null;
  }

  return resolvePath(aliasInfo.path, user);
}

module.exports = {
  instancePath,
  slugifyInstance,
  lookupAlias,
  canonicalAliasForPath,
  customSlugForInstance,
  customSlugsForInstances,
  createInstanceAliases,
  setInstanceSlug,
  deleteInstanceAliases,
  resolvePath,
  resolveRequestPath,
};
