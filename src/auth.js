const { Issuer } = require("openid-client");
const { pool } = require("./db/pool");
const UserStorage = require("./storage/userStorage");
const { insertQuery, updateQuery } = require("./services/queryService");
const OIDC_CONFIGURATION_URL = process.env.OIDC_CONFIGURATION_URL;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
const OIDC_REDIRECT_URI = process.env.OIDC_REDIRECT_URI;
const APP_BASE_URL = process.env.APP_BASE_URL;
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

let oidcClientPromise;

async function getOidcClient(req) {
  if (!oidcClientPromise) {
    oidcClientPromise = Issuer.discover(OIDC_CONFIGURATION_URL).then((issuer) => {
      return new issuer.Client({
        client_id: OIDC_CLIENT_ID,
        client_secret: OIDC_CLIENT_SECRET,
        redirect_uris: [getRedirectUri(req)],
        response_types: ["code"],
      });
    });
  }

  return oidcClientPromise;
}

function getRedirectUri(req) {
  if (OIDC_REDIRECT_URI) return OIDC_REDIRECT_URI;
  const baseUrl = APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
  return new URL("/auth/callback", baseUrl).toString();
}

async function isGlobalAdmin(userGuid) {
  const user = await UserStorage.global().load(userGuid);
  return user?.admin || false;
}

async function requireAdmin(req, res, next) {
  if (!req.session.user) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  try {
    // Refresh admin status dynamically from the database
    const isAdmin = await isGlobalAdmin(req.session.user.guid);

    if (isAdmin) {
      req.session.user.admin = true;
      next();
      return;
    }
  } catch (error) {
    next(error);
    return;
  }

  res.status(403).json({ error: "Admin access required" });
}

function ensureAuthenticated(req, res, next) {
  if (req.session.user) {
    next();
    return;
  }

  if (req.path.startsWith("/api/")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
}

async function upsertUser({ issuer, subject, email, displayName }) {
  const normalizedEmail = email ? email.toLowerCase() : null;
  const configuredAdmin = normalizedEmail ? ADMIN_EMAILS.has(normalizedEmail) : false;
  const query = insertQuery()
    .into("genrpg", "users")
    .values(
      ["oidc_issuer", "oidc_subject", "email", "display_name"],
      [issuer, subject, normalizedEmail, displayName],
    )
    .onConflict(["oidc_issuer", "oidc_subject"], "DO UPDATE")
    .returning(null, ["guid", "email", "display_name", "admin"]);

  const result = await pool.query(query.toString(), query.params);
  let user = result.rows[0];

  if (configuredAdmin && !user.admin) {
    const userAlias = "u";
    const promoteQuery = updateQuery()
      .from("genrpg", "users", userAlias)
      .set("admin", true)
      .whereColumn(userAlias, "guid", user.guid)
      .returning(userAlias, ["guid", "email", "display_name", "admin"]);

    const promoted = await pool.query(promoteQuery.toString(), promoteQuery.params);
    user = promoted.rows[0];
  }

  return user;
}

function userSummary(row) {
  return {
    guid: row.guid,
    email: row.email,
    displayName: row.display_name,
    admin: row.admin,
  };
}

module.exports = {
  getOidcClient,
  getRedirectUri,
  isGlobalAdmin,
  requireAdmin,
  ensureAuthenticated,
  upsertUser,
  userSummary,
};
