const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const { pool } = require("./db/pool");
const { isGlobalAdmin } = require("./auth");
const { deleteQuery } = require("./services/queryService");

const RESERVED_ALIAS_PREFIXES = ["api", "static", "auth", "login", "logout", "healthz"];

const APP_HTML_PATH = path.join(__dirname, "..", "public", "app.html");

function normalizeAlias(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.replace(/^\/+|\/+$/g, "");
}

function normalizeRequestPath(requestPath) {
  return normalizeAlias(requestPath);
}

function validateAlias(alias) {
  const normalized = normalizeAlias(alias);
  if (!normalized) {
    return { valid: false, error: "Alias is required" };
  }

  const firstSegment = normalized.split("/")[0].toLowerCase();
  if (RESERVED_ALIAS_PREFIXES.includes(firstSegment)) {
    return { valid: false, error: "Alias uses a reserved path prefix" };
  }

  return { valid: true, alias: normalized };
}

function defaultInstanceAlias(instanceGuid) {
  return `instance/${instanceGuid}`;
}

function defaultInstancePath(instanceGuid) {
  return `instance:${instanceGuid}`;
}

function slugifyInstanceUrlSegment(value) {
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

function isProperlySlugified(value) {
  if (value == null || typeof value !== "string") {
    return true;
  }
  return value === slugifyInstanceUrlSegment(value);
}

function instanceAliasFromSegment(segment) {
  return `instance/${segment}`;
}

const MAX_CUSTOM_ALIAS_ATTEMPTS = 100;

async function createCustomInstanceAlias(client, instanceGuid, slugSegment) {
  const baseSegment = slugifyInstanceUrlSegment(slugSegment);
  if (!baseSegment) {
    return null;
  }

  const pathValue = defaultInstancePath(instanceGuid);
  let suffix = 0;

  for (let attempt = 0; attempt < MAX_CUSTOM_ALIAS_ATTEMPTS; attempt += 1) {
    const segment = suffix === 0 ? baseSegment : `${baseSegment}-${suffix}`;
    const alias = instanceAliasFromSegment(segment);
    const validation = validateAlias(alias);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const existing = await lookupAlias(alias);
    if (existing) {
      if (existing.path === pathValue) {
        return validation.alias;
      }
      suffix += 1;
      continue;
    }

    const result = await client.query(
      `
        INSERT INTO genrpg.url_aliases (guid, alias, path)
        VALUES ($1, $2, $3)
        ON CONFLICT (alias) DO NOTHING
        RETURNING alias
      `,
      [crypto.randomUUID(), validation.alias, pathValue],
    );

    if (result.rowCount > 0) {
      return validation.alias;
    }

    suffix += 1;
  }

  throw new Error("Unable to allocate a unique instance URL alias");
}

async function loadAccessibleInstance(instanceGuid, user) {
  const isAdmin = await isGlobalAdmin(user.guid);
  const result = await pool.query(
    `
      SELECT
        i.guid,
        i.name,
        i.description,
        i.packages
      FROM genrpg.instances i
      LEFT JOIN genrpg.instance_user_roles iur
        ON iur.instance_guid = i.guid
        AND iur.user_guid = $1
      WHERE i.guid = $2
        AND ($3::boolean OR iur.user_guid IS NOT NULL)
    `,
    [user.guid, instanceGuid, isAdmin],
  );

  return result.rows[0] || null;
}

async function getUserInstancePermissions(instanceGuid, userGuid) {
  const result = await pool.query(
    `
      SELECT DISTINCT p.name
      FROM genrpg.instance_user_roles iur
      JOIN genrpg.role_permissions rp ON rp.role_id = iur.role_id
      JOIN genrpg.permissions p ON p.id = rp.permission_id
      WHERE iur.instance_guid = $1 AND iur.user_guid = $2
    `,
    [instanceGuid, userGuid],
  );
  return new Set(result.rows.map((r) => r.name));
}

async function canUserRunInstance(instanceGuid, user) {
  if (await isGlobalAdmin(user.guid)) {
    return true;
  }
  const permissions = await getUserInstancePermissions(instanceGuid, user.guid);
  return permissions.has("instance.run");
}

async function lookupAlias(alias) {
  const normalized = normalizeAlias(alias);
  if (!normalized) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT guid, alias, path
      FROM genrpg.url_aliases
      WHERE alias = $1
    `,
    [normalized],
  );

  return result.rows[0] || null;
}

async function isAliasAvailable(alias, { excludeInstanceGuid } = {}) {
  const row = await lookupAlias(alias);
  if (!row) {
    return true;
  }

  if (excludeInstanceGuid) {
    return row.path === defaultInstancePath(excludeInstanceGuid);
  }

  return false;
}

async function lookupCanonicalAliasForPath(pathValue) {
  const result = await pool.query(
    `
      SELECT alias
      FROM genrpg.url_aliases
      WHERE path = $1
      ORDER BY length(alias) ASC, alias ASC
      LIMIT 1
    `,
    [pathValue],
  );

  return result.rows[0]?.alias || null;
}

async function resolveInstancePath(instanceGuid, user) {
  const instance = await loadAccessibleInstance(instanceGuid, user);
  if (!instance) {
    return null;
  }

  const canRun = await canUserRunInstance(instanceGuid, user);
  if (!canRun) {
    return null;
  }

  return {
    type: "instance",
    guid: instance.guid,
    name: instance.name,
  };
}

const pathResolvers = {
  instance: resolveInstancePath,
};

function parsePath(pathValue) {
  if (!pathValue || typeof pathValue !== "string") {
    return null;
  }

  const separatorIndex = pathValue.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === pathValue.length - 1) {
    return null;
  }

  return {
    type: pathValue.slice(0, separatorIndex),
    payload: pathValue.slice(separatorIndex + 1),
  };
}

async function resolvePath(pathValue, user) {
  const parsed = parsePath(pathValue);
  if (!parsed) {
    return null;
  }

  const resolver = pathResolvers[parsed.type];
  if (!resolver) {
    return null;
  }

  return resolver(parsed.payload, user);
}

async function resolveAlias(alias, user) {
  const row = await lookupAlias(alias);
  if (!row) {
    return null;
  }

  return resolvePath(row.path, user);
}

async function resolveRequestPath(requestPath, user) {
  const alias = normalizeRequestPath(requestPath);
  if (!alias) {
    return null;
  }

  return resolveAlias(alias, user);
}

async function createDefaultInstanceAlias(client, instanceGuid) {
  const alias = defaultInstanceAlias(instanceGuid);
  const pathValue = defaultInstancePath(instanceGuid);
  const validation = validateAlias(alias);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  await client.query(
    `
      INSERT INTO genrpg.url_aliases (guid, alias, path)
      VALUES ($1, $2, $3)
      ON CONFLICT (alias) DO NOTHING
    `,
    [crypto.randomUUID(), validation.alias, pathValue],
  );
}

async function deleteAliasesForInstance(client, instanceGuid) {
  const tableAlias = "ua";
  const query = deleteQuery()
    .from("genrpg", "url_aliases", tableAlias)
    .whereColumn(tableAlias, "path", defaultInstancePath(instanceGuid));

  await client.query(query.toString(), query.params);
}

async function lookupCustomInstanceUrlSegment(instanceGuid) {
  const pathValue = defaultInstancePath(instanceGuid);
  const defaultAlias = defaultInstanceAlias(instanceGuid);
  const result = await pool.query(
    `
      SELECT alias
      FROM genrpg.url_aliases
      WHERE path = $1 AND alias <> $2
      ORDER BY length(alias) ASC, alias ASC
      LIMIT 1
    `,
    [pathValue, defaultAlias],
  );

  const alias = result.rows[0]?.alias;
  if (!alias || !alias.startsWith("instance/")) {
    return "";
  }

  return alias.slice("instance/".length);
}

async function deleteCustomInstanceAlias(client, instanceGuid) {
  const tableAlias = "ua";
  const query = deleteQuery()
    .from("genrpg", "url_aliases", tableAlias)
    .whereColumn(tableAlias, "path", defaultInstancePath(instanceGuid))
    .whereColumn(tableAlias, "alias", defaultInstanceAlias(instanceGuid), "<>");

  await client.query(query.toString(), query.params);
}

async function syncCustomInstanceAlias(client, instanceGuid, slugSegment) {
  const segment = slugifyInstanceUrlSegment(slugSegment);
  await deleteCustomInstanceAlias(client, instanceGuid);
  if (!segment) {
    return null;
  }
  return createCustomInstanceAlias(client, instanceGuid, segment);
}

let appHtmlCache;

async function getAppHtmlTemplate() {
  if (!appHtmlCache) {
    appHtmlCache = await fs.readFile(APP_HTML_PATH, "utf8");
  }
  return appHtmlCache;
}

async function sendAppHtml(res, boot) {
  let html = await getAppHtmlTemplate();

  if (boot) {
    const bootScript = `<script>window.__GENRPG_BOOT__=${JSON.stringify(boot)};</script>`;
    html = html.replace("</head>", `${bootScript}</head>`);
  }

  res.type("html").send(html);
}

module.exports = {
  normalizeAlias,
  slugifyInstanceUrlSegment,
  isProperlySlugified,
  instanceAliasFromSegment,
  lookupAlias,
  isAliasAvailable,
  lookupCanonicalAliasForPath,
  resolveAlias,
  resolvePath,
  resolveRequestPath,
  createDefaultInstanceAlias,
  createCustomInstanceAlias,
  deleteAliasesForInstance,
  lookupCustomInstanceUrlSegment,
  syncCustomInstanceAlias,
  sendAppHtml,
};
