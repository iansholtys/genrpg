const path = require("node:path");
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);

const { pool } = require("./db/pool");
const { applySchemaVersions } = require("./db/versions");
const { applyPackageUpdates } = require("./updates");
const { refreshPackageSubscribers } = require("./events/packageEvents");
const { REPO_ROOT, refreshPackageCache } = require("./packages");

const { ensureAuthenticated } = require("./auth");
const { resolveRequestPath, sendAppHtml } = require("./aliases");
const authRouter = require("./routes/auth");
const genrpgApi = require("./api");

const PORT = Number(process.env.PORT || 3000);

/**
 * Ensure required environment variables are present.
 */
function validateConfig() {
  const missing = [];

  for (const key of [
    "OIDC_CONFIGURATION_URL",
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET",
    "SESSION_SECRET",
  ]) {
    if (!process.env[key]) missing.push(key);
  }

  if (!process.env.DATABASE_URL && !process.env.PGHOST) {
    missing.push("DATABASE_URL or PGHOST/PGDATABASE/PGUSER/PGPASSWORD");
  }

  if (missing.length) {
    throw new Error(`Missing required configuration: ${missing.join(", ")}`);
  }
}

const app = express();
app.set("trust proxy", process.env.TRUST_PROXY || "loopback");
app.use(express.json());
app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "session",
      schemaName: "genrpg",
      createTableIfMissing: false,
    }),
    name: "genrpg.sid",
    secret: process.env.SESSION_SECRET,
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

// Use auth router for /login, /logout, /auth/*
app.use("/", authRouter);

const publicDir = path.join(__dirname, "..", "public");

app.use(
  "/static/css",
  express.static(path.join(publicDir, "css"), { index: false, fallthrough: false }),
);
app.use(
  "/static/components",
  express.static(path.join(publicDir, "components"), { index: false, fallthrough: false }),
);
app.use(
  "/static/js",
  express.static(path.join(publicDir, "js"), { index: false, fallthrough: false }),
);
app.use(
  "/static/pkg",
  ensureAuthenticated,
  express.static(REPO_ROOT, { index: false, fallthrough: false }),
);

// Require authentication for all routes below
app.use(ensureAuthenticated);

// Protected API routes
app.use("/api/genrpg", genrpgApi);

async function sendAppForRequest(req, res, next) {
  try {
    const boot = await resolveRequestPath(req.path, req.session.user);
    await sendAppHtml(res, boot);
  } catch (error) {
    next(error);
  }
}

app.get("/", sendAppForRequest);

app.use((req, res, next) => {
  if (req.accepts("html")) {
    sendAppForRequest(req, res, next);
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

/**
 * Ensure schema is current before the app accepts HTTP traffic.
 */
async function prepareDatabase() {
  // Ensure genrpg schema exists.
  // @todo: Come up with a dedicated installation process so we only check this once.
  await pool.query("CREATE SCHEMA IF NOT EXISTS genrpg");

  const { applied } = await applySchemaVersions({ pool });
  if (applied.length) {
    console.log(`Applied database schema versions: ${applied.join(", ")}`);
  }

  const { applied: updatesApplied, installApplied } = await applyPackageUpdates(pool);
  if (updatesApplied.length) {
    console.log(
      `Applied package database updates: ${updatesApplied.map((entry) => entry.machineName).join(", ")}`,
    );
  }
  if (installApplied?.length) {
    console.log(
      `Applied package install steps: ${installApplied.map((entry) => `${entry.machineName} (global v${entry.toVersion})`).join(", ")}`,
    );
  }
}

/**
 * Application startup: validate config, prepare dependencies, then listen for HTTP.
 */
async function main() {
  validateConfig();
  await prepareDatabase();
  await refreshPackageSubscribers({ force: true });
  await refreshPackageCache();

  app.listen(PORT, () => {
    console.log(`GenRPG listening on port ${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
