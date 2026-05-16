const crypto = require("node:crypto");
const path = require("node:path");

const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Issuer, generators } = require("openid-client");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-in-production";
const OIDC_CONFIGURATION_URL = process.env.OIDC_CONFIGURATION_URL;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
const OIDC_REDIRECT_URI = process.env.OIDC_REDIRECT_URI;
const OIDC_SCOPES = process.env.OIDC_SCOPES || "openid email profile";
const APP_BASE_URL = process.env.APP_BASE_URL;
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
});

let oidcClientPromise;

function requireConfig() {
  const missing = [];

  if (!OIDC_CONFIGURATION_URL) missing.push("OIDC_CONFIGURATION_URL");
  if (!OIDC_CLIENT_ID) missing.push("OIDC_CLIENT_ID");
  if (!OIDC_CLIENT_SECRET) missing.push("OIDC_CLIENT_SECRET");
  if (SESSION_SECRET === "change-me-in-production") missing.push("SESSION_SECRET");
  if (!process.env.DATABASE_URL && !process.env.PGHOST) {
    missing.push("DATABASE_URL or PGHOST/PGDATABASE/PGUSER/PGPASSWORD");
  }

  if (missing.length) {
    throw new Error(`Missing required configuration: ${missing.join(", ")}`);
  }
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      guid uuid PRIMARY KEY,
      oidc_issuer text NOT NULL,
      oidc_subject text NOT NULL,
      email text,
      display_name text,
      admin boolean NOT NULL DEFAULT false,
      create_datetime timestamptz NOT NULL DEFAULT now(),
      update_datetime timestamptz NOT NULL DEFAULT now(),
      UNIQUE (oidc_issuer, oidc_subject)
    );

    CREATE TABLE IF NOT EXISTS instances (
      guid uuid PRIMARY KEY,
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      create_datetime timestamptz NOT NULL DEFAULT now(),
      update_datetime timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS instance_user_permissions (
      instance_guid uuid NOT NULL REFERENCES instances(guid) ON DELETE CASCADE,
      user_guid uuid NOT NULL REFERENCES users(guid) ON DELETE CASCADE,
      permission text NOT NULL CHECK (permission IN ('Owner', 'Editor', 'Viewer')),
      create_datetime timestamptz NOT NULL DEFAULT now(),
      update_datetime timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (instance_guid, user_guid)
    );

    CREATE INDEX IF NOT EXISTS idx_instance_user_permissions_user
      ON instance_user_permissions(user_guid);

    CREATE OR REPLACE FUNCTION set_update_datetime()
    RETURNS trigger AS $$
    BEGIN
      NEW.update_datetime = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS users_update_datetime ON users;
    CREATE TRIGGER users_update_datetime
      BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION set_update_datetime();

    DROP TRIGGER IF EXISTS instances_update_datetime ON instances;
    CREATE TRIGGER instances_update_datetime
      BEFORE UPDATE ON instances
      FOR EACH ROW EXECUTE FUNCTION set_update_datetime();

    DROP TRIGGER IF EXISTS instance_user_permissions_update_datetime ON instance_user_permissions;
    CREATE TRIGGER instance_user_permissions_update_datetime
      BEFORE UPDATE ON instance_user_permissions
      FOR EACH ROW EXECUTE FUNCTION set_update_datetime();
  `);
}

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

function toSafeReturnPath(value) {
  if (!value || typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.startsWith("/auth/") || value === "/login" || value === "/logout") return "/";
  return value;
}

async function upsertUser({ issuer, subject, email, displayName }) {
  const normalizedEmail = email ? email.toLowerCase() : null;
  const configuredAdmin = normalizedEmail ? ADMIN_EMAILS.has(normalizedEmail) : false;
  const userGuid = crypto.randomUUID();
  const result = await pool.query(
    `
      INSERT INTO users (guid, oidc_issuer, oidc_subject, email, display_name, admin)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (oidc_issuer, oidc_subject)
      DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        admin = users.admin OR EXCLUDED.admin
      RETURNING guid, email, display_name, admin
    `,
    [userGuid, issuer, subject, normalizedEmail, displayName, configuredAdmin],
  );

  return result.rows[0];
}

function userSummary(row) {
  return {
    guid: row.guid,
    email: row.email,
    displayName: row.display_name,
    admin: row.admin,
  };
}

const app = express();
app.set("trust proxy", process.env.TRUST_PROXY || "loopback");
app.use(express.json());
app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    name: "genrpg.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 1000 * 60 * 60 * 8,
    },
  }),
);

app.get("/healthz", (req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/login", (req, res) => {
  if (req.session.user) {
    res.redirect("/");
    return;
  }

  res.sendFile(path.join(__dirname, "..", "public", "login.html"));
});

app.get("/auth/login", async (req, res, next) => {
  try {
    const client = await getOidcClient(req);
    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    req.session.oidc = {
      state,
      nonce,
      codeVerifier,
      returnTo: toSafeReturnPath(req.query.returnTo),
    };

    const authorizationUrl = client.authorizationUrl({
      scope: OIDC_SCOPES,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      redirect_uri: getRedirectUri(req),
    });

    res.redirect(authorizationUrl);
  } catch (error) {
    next(error);
  }
});

app.get("/auth/callback", async (req, res, next) => {
  try {
    if (!req.session.oidc) {
      res.status(400).send("Login session is missing. Please start login again.");
      return;
    }

    const client = await getOidcClient(req);
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(getRedirectUri(req), params, {
      state: req.session.oidc.state,
      nonce: req.session.oidc.nonce,
      code_verifier: req.session.oidc.codeVerifier,
    });
    const claims = tokenSet.claims();
    const user = await upsertUser({
      issuer: client.issuer.issuer,
      subject: claims.sub,
      email: claims.email,
      displayName: claims.name || claims.preferred_username || claims.email || claims.sub,
    });
    const returnTo = req.session.oidc.returnTo || "/";

    req.session.oidc = null;
    req.session.user = userSummary(user);
    res.redirect(returnTo);
  } catch (error) {
    next(error);
  }
});

app.post("/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      next(error);
      return;
    }

    res.clearCookie("genrpg.sid");
    res.redirect("/login");
  });
});

app.get("/static/:asset", (req, res) => {
  if (!["app.js", "styles.css"].includes(req.params.asset)) {
    res.status(404).send("Not found");
    return;
  }

  res.sendFile(path.join(__dirname, "..", "public", req.params.asset));
});
app.use(ensureAuthenticated);

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user });
});

app.get("/api/instances", async (req, res, next) => {
  try {
    const user = req.session.user;
    const result = await pool.query(
      `
        SELECT
          i.guid,
          i.name,
          i.description,
          i.create_datetime,
          i.update_datetime,
          CASE
            WHEN $2::boolean THEN 'Admin'
            ELSE iup.permission
          END AS permission
        FROM instances i
        LEFT JOIN instance_user_permissions iup
          ON iup.instance_guid = i.guid
          AND iup.user_guid = $1
        WHERE $2::boolean OR iup.user_guid IS NOT NULL
        ORDER BY i.update_datetime DESC
      `,
      [user.guid, user.admin],
    );

    res.json({ instances: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post("/api/instances", async (req, res, next) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const description =
      typeof req.body.description === "string" ? req.body.description.trim() : "";

    if (!name) {
      res.status(400).json({ error: "Instance name is required" });
      return;
    }

    const instanceGuid = crypto.randomUUID();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const instance = await client.query(
        `
          INSERT INTO instances (guid, name, description)
          VALUES ($1, $2, $3)
          RETURNING guid, name, description, create_datetime, update_datetime
        `,
        [instanceGuid, name, description],
      );

      if (!req.session.user.admin) {
        await client.query(
          `
            INSERT INTO instance_user_permissions (instance_guid, user_guid, permission)
            VALUES ($1, $2, 'Owner')
          `,
          [instanceGuid, req.session.user.guid],
        );
      }

      await client.query("COMMIT");
      res.status(201).json({
        instance: {
          ...instance.rows[0],
          permission: req.session.user.admin ? "Admin" : "Owner",
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "app.html"));
});

app.use((req, res) => {
  if (req.accepts("html")) {
    res.sendFile(path.join(__dirname, "..", "public", "app.html"));
    return;
  }

  res.status(404).json({ error: "Not found" });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) {
    next(error);
    return;
  }

  const status = error.status || 500;
  if (req.path.startsWith("/api/")) {
    res.status(status).json({ error: status === 500 ? "Internal server error" : error.message });
    return;
  }

  res.status(status).send(status === 500 ? "Internal server error" : error.message);
});

async function main() {
  requireConfig();
  await initializeDatabase();
  app.listen(PORT, () => {
    console.log(`GenRPG listening on port ${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
