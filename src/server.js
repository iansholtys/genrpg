const crypto = require("node:crypto");
const path = require("node:path");
const os = require("node:os");
const { exec } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const yaml = require("yaml");
const semver = require("semver");

const execAsync = promisify(exec);

const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Issuer, generators } = require("openid-client");

const { pool } = require("./db/pool");
const { applySchemaVersions } = require("./db/versions");
const {
  PackageLoadError,
  REPO_ROOT,
  loadPackages,
  loadPackagesWithAssets,
  invalidatePackageCache,
  parsePackageCsv,
  validatePackageSelection,
  resolveInstanceAssets,
} = require("./packages");
const {
  PackageUpdateError,
  applyPackageUpdates,
  applyPackageUpdatesForMachine,
  checkPackageUpdates,
} = require("./updates");

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

function requireAdmin(req, res, next) {
  if (req.session.user?.admin) {
    next();
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
      INSERT INTO genrpg.users (guid, oidc_issuer, oidc_subject, email, display_name, admin)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (oidc_issuer, oidc_subject)
      DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        admin = genrpg.users.admin OR EXCLUDED.admin
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
      schemaName: "genrpg",
      createTableIfMissing: false,
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

const publicDir = path.join(__dirname, "..", "public");

app.use(
  "/static/css",
  express.static(path.join(publicDir, "css"), { index: false, fallthrough: false }),
);
app.use(
  "/static/components",
  express.static(path.join(publicDir, "components"), { index: false, fallthrough: false }),
);
app.get("/static/app.js", (req, res) => {
  res.sendFile(path.join(publicDir, "app.js"));
});
app.use(
  "/static/pkg",
  ensureAuthenticated,
  express.static(REPO_ROOT, { index: false, fallthrough: false }),
);
app.use(ensureAuthenticated);

const genrpgApi = express.Router();

genrpgApi.get("/me", (req, res) => {
  res.json({ user: req.session.user });
});

genrpgApi.get("/packages", async (req, res, next) => {
  try {
    res.json(await loadPackages({ strict: false }));
  } catch (error) {
    if (error instanceof PackageLoadError) {
      res.status(error.status).json({ error: error.message, details: error.details });
      return;
    }

    next(error);
  }
});

async function previewGitPackage(url) {
  const tmpDir = path.join(os.tmpdir(), "genrpg-pkg-" + crypto.randomUUID());
  
  try {
    await fs.mkdir(tmpDir, { recursive: true });
    await execAsync(`git clone --depth 1 "${url}" "${tmpDir}"`);
    
    const files = await fs.readdir(tmpDir);
    const manifestFile = files.find(f => f.endsWith(".package.yml") || f.endsWith(".package.yaml"));
    
    if (!manifestFile) {
      throw new Error("No *.package.yml or *.package.yaml found in the repository root.");
    }
    
    const manifestContent = await fs.readFile(path.join(tmpDir, manifestFile), "utf8");
    const raw = yaml.parse(manifestContent);
    
    if (!raw.name || !raw.machine_name || !raw.version) {
      throw new Error("Manifest is missing name, machine_name, or version.");
    }
    
    return {
      name: raw.name,
      machineName: raw.machine_name,
      remoteVersion: raw.version,
    };
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {
      console.error("Failed to clean up tmp dir", e);
    }
  }
}

genrpgApi.get("/packages/git/status", requireAdmin, async (req, res, next) => {
  try {
    const { packages, configurationIssues } = await loadPackages({ strict: false });
    const statuses = [];

    for (const pkg of packages) {
      if (pkg.machineName === "genrpg") continue;

      const pkgPath = path.join(__dirname, "..", pkg.path);
      try {
        await fs.access(path.join(pkgPath, ".git"));
      } catch {
        continue; // Not a git repository
      }

      try {
        const { stdout: urlStdout } = await execAsync(`git remote get-url origin`, { cwd: pkgPath });
        const url = urlStdout.trim();

        await execAsync(`git fetch origin`, { cwd: pkgPath });
        
        let branchRef = "origin/main";
        try {
          const { stdout: refStdout } = await execAsync(`git rev-parse --abbrev-ref origin/HEAD`, { cwd: pkgPath });
          if (refStdout.trim()) {
            branchRef = refStdout.trim();
          }
        } catch {
          // fallback to origin/main
        }

        const { stdout: manifestContent } = await execAsync(`git show ${branchRef}:${pkg.machineName}.package.yml`, { cwd: pkgPath });
        const raw = yaml.parse(manifestContent);
        const remoteVersion = raw.version || "0.0.0";

        const canUpdate = semver.valid(remoteVersion) && semver.valid(pkg.version) 
                          ? semver.gt(remoteVersion, pkg.version) 
                          : false;

        statuses.push({
          name: pkg.name,
          machineName: pkg.machineName,
          localVersion: pkg.version,
          remoteVersion,
          url,
          canUpdate
        });
      } catch (err) {
        console.error(`Failed to get git status for ${pkg.machineName}:`, err);
      }
    }

    res.json({ statuses, configurationIssues });
  } catch (error) {
    if (error instanceof PackageLoadError) {
      res.status(error.status).json({ error: error.message, details: error.details });
      return;
    }

    next(error);
  }
});

genrpgApi.post("/packages/git/preview", requireAdmin, async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "Repository URL is required" });
    }
    
    const preview = await previewGitPackage(url);

    const { packages } = await loadPackages({ strict: false });
    const localPkg = packages.find(p => p.machineName === preview.machineName);
    
    const localVersion = localPkg ? localPkg.version : null;
    const isNew = !localVersion;
    const canUpdate = localVersion && semver.valid(preview.remoteVersion) && semver.valid(localVersion) 
                      ? semver.gt(preview.remoteVersion, localVersion) 
                      : false;
    
    res.json({
      ...preview,
      localVersion,
      isNew,
      canUpdate
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to preview package" });
  }
});

genrpgApi.post("/packages/git/pull", requireAdmin, async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "Repository URL is required" });
    }
    
    const preview = await previewGitPackage(url);
    const targetDir = path.join(__dirname, "..", "packages", preview.machineName);
    
    try {
      await fs.access(targetDir);
      // Exists. Pull updates.
      await execAsync(`git remote set-url origin "${url}"`, { cwd: targetDir });
      await execAsync(`git pull`, { cwd: targetDir });
    } catch {
      // Doesn't exist. Clone.
      await execAsync(`git clone "${url}" "${targetDir}"`);
    }
    
    invalidatePackageCache();

    let updateWarning = null;
    try {
      await applySchemaVersions({ pool });
      await applyPackageUpdatesForMachine(pool, preview.machineName);
    } catch (error) {
      console.error(`Failed to apply DB updates for ${preview.machineName}:`, error);
      updateWarning = error.message || "Failed to apply package database updates";
    }

    const { configurationIssues } = await loadPackages({ strict: false });

    res.json({
      success: true,
      configurationIssues,
      updateWarning,
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to pull package" });
  }
});

genrpgApi.post("/update", requireAdmin, async (req, res, next) => {
  try {
    if (req.body?.update === true) {
      res.json(await applyPackageUpdates(pool));
      return;
    }

    res.json(await checkPackageUpdates(pool));
  } catch (error) {
    if (error instanceof PackageUpdateError) {
      res.status(error.status).json({ error: error.message, details: error.details });
      return;
    }

    next(error);
  }
});

async function loadAccessibleInstance(instanceGuid, user) {
  const result = await pool.query(
    `
      SELECT
        i.guid,
        i.name,
        i.description,
        i.packages
      FROM genrpg.instances i
      LEFT JOIN genrpg.instance_user_permissions iup
        ON iup.instance_guid = i.guid
        AND iup.user_guid = $1
      WHERE i.guid = $2
        AND ($3::boolean OR iup.user_guid IS NOT NULL)
    `,
    [user.guid, instanceGuid, user.admin],
  );

  return result.rows[0] || null;
}

// Resolves instance package assets from the in-memory package cache (no per-request YAML I/O).
genrpgApi.get("/instances/:guid/assets", async (req, res, next) => {
  try {
    const instance = await loadAccessibleInstance(req.params.guid, req.session.user);
    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    const packageNames = parsePackageCsv(instance.packages);
    const { packages } = await loadPackagesWithAssets();
    const assets = resolveInstanceAssets(packageNames, packages);

    res.json({
      css: assets.css,
      js: assets.js,
      packageNames: assets.packageNames,
    });
  } catch (error) {
    if (error instanceof PackageLoadError) {
      res.status(error.status).json({ error: error.message, details: error.details });
      return;
    }

    next(error);
  }
});

genrpgApi.get("/instances", async (req, res, next) => {
  try {
    const user = req.session.user;
    const result = await pool.query(
      `
        SELECT
          i.guid,
          i.name,
          i.description,
          i.packages,
          i.create_datetime,
          i.update_datetime,
          CASE
            WHEN $2::boolean THEN 'Admin'
            ELSE iup.permission
          END AS permission
        FROM genrpg.instances i
        LEFT JOIN genrpg.instance_user_permissions iup
          ON iup.instance_guid = i.guid
          AND iup.user_guid = $1
        WHERE $2::boolean OR iup.user_guid IS NOT NULL
        ORDER BY i.update_datetime DESC
      `,
      [user.guid, user.admin],
    );

    res.json({
      instances: result.rows.map((instance) => ({
        ...instance,
        packageNames: parsePackageCsv(instance.packages),
      })),
    });
  } catch (error) {
    next(error);
  }
});

genrpgApi.post("/instances", async (req, res, next) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const description =
      typeof req.body.description === "string" ? req.body.description.trim() : "";
    const selectedPackages = Array.isArray(req.body.packages) ? req.body.packages : null;

    if (!name) {
      res.status(400).json({ error: "Instance name is required" });
      return;
    }

    if (!selectedPackages) {
      res.status(400).json({ error: "Packages are required" });
      return;
    }

    const { packages } = await loadPackages({ strict: true });
    const packageSelection = validatePackageSelection(selectedPackages, packages);
    if (!packageSelection.valid) {
      res.status(400).json({ error: "Invalid package selection", details: packageSelection.details });
      return;
    }

    const instanceGuid = crypto.randomUUID();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const instance = await client.query(
        `
          INSERT INTO genrpg.instances (guid, name, description, packages)
          VALUES ($1, $2, $3, $4)
          RETURNING guid, name, description, packages, create_datetime, update_datetime
        `,
        [instanceGuid, name, description, packageSelection.packageCsv],
      );

      if (!req.session.user.admin) {
        await client.query(
          `
            INSERT INTO genrpg.instance_user_permissions (instance_guid, user_guid, permission)
            VALUES ($1, $2, 'Owner')
          `,
          [instanceGuid, req.session.user.guid],
        );
      }

      await client.query("COMMIT");
      res.status(201).json({
        instance: {
          ...instance.rows[0],
          packageNames: parsePackageCsv(instance.rows[0].packages),
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
    if (error instanceof PackageLoadError) {
      res.status(error.status).json({ error: error.message, details: error.details });
      return;
    }

    next(error);
  }
});

app.use("/api/genrpg", genrpgApi);

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

  // Ensure the genrpg schema exists before anything else, so the session
  // table (and other core tables) can be created by applySchemaVersions.
  await pool.query('CREATE SCHEMA IF NOT EXISTS genrpg');

  const { applied } = await applySchemaVersions({ pool });
  if (applied.length) {
    console.log(`Applied database schema versions: ${applied.join(", ")}`);
  }

  app.listen(PORT, () => {
    console.log(`GenRPG listening on port ${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
