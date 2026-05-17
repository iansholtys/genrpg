const crypto = require("node:crypto");
const path = require("node:path");
const os = require("node:os");
const { exec } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const yaml = require("yaml");
const semver = require("semver");
const express = require("express");

const { pool } = require("../db/pool");
const { applySchemaVersions } = require("../db/versions");
const { requireAdmin } = require("../auth");
const {
  PackageLoadError,
  loadPackages,
  invalidatePackageCache,
} = require("../packages");
const {
  PackageUpdateError,
  applyPackageUpdates,
  applyPackageUpdatesForMachine,
  checkPackageUpdates,
} = require("../updates");

const execAsync = promisify(exec);

const packagesRouter = express.Router();

packagesRouter.get("/packages", async (req, res, next) => {
  try {
    const data = await loadPackages({ strict: false });
    const client = await pool.connect();
    try {
      const result = await client.query(`SELECT package FROM genrpg.packages`);
      const installedSet = new Set(result.rows.map((r) => r.package));
      data.packages = data.packages.map((pkg) => ({
        ...pkg,
        installed: installedSet.has(pkg.machineName),
      }));
    } finally {
      client.release();
    }
    res.json(data);
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

packagesRouter.get("/packages/git/status", requireAdmin, async (req, res, next) => {
  try {
    const { packages, configurationIssues } = await loadPackages({ strict: false });

    const client = await pool.connect();
    let installedSet;
    try {
      const result = await client.query(`SELECT package FROM genrpg.packages`);
      installedSet = new Set(result.rows.map((r) => r.package));
    } finally {
      client.release();
    }

    const statuses = [];

    for (const pkg of packages) {
      if (pkg.machineName === "genrpg") continue;

      const pkgPath = path.join(__dirname, "..", "..", pkg.path);
      const installed = installedSet.has(pkg.machineName);

      // Check if it's a git repository
      let isGitRepo = false;
      try {
        await fs.access(path.join(pkgPath, ".git"));
        isGitRepo = true;
      } catch {
        // Not a git repository
      }

      if (!isGitRepo) {
        // Still include non-git packages so they can be installed
        statuses.push({
          name: pkg.name,
          machineName: pkg.machineName,
          localVersion: pkg.version,
          remoteVersion: pkg.version,
          url: "",
          canUpdate: false,
          installed,
        });
        continue;
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
          canUpdate,
          installed,
        });
      } catch (err) {
        console.error(`Failed to get git status for ${pkg.machineName}:`, err);
        // Still include the package so it can be installed even if git status fails
        statuses.push({
          name: pkg.name,
          machineName: pkg.machineName,
          localVersion: pkg.version,
          remoteVersion: pkg.version,
          url: "",
          canUpdate: false,
          installed,
        });
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

packagesRouter.post("/packages/git/preview", requireAdmin, async (req, res, next) => {
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

packagesRouter.post("/packages/git/pull", requireAdmin, async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "Repository URL is required" });
    }
    
    const preview = await previewGitPackage(url);
    const targetDir = path.join(__dirname, "..", "..", "packages", preview.machineName);
    
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

packagesRouter.post("/packages/install", requireAdmin, async (req, res, next) => {
  try {
    const { machineName } = req.body;
    if (!machineName || typeof machineName !== "string") {
      return res.status(400).json({ error: "machineName is required" });
    }

    const { packages } = await loadPackages({ strict: false });
    const pkg = packages.find((p) => p.machineName === machineName);
    if (!pkg) {
      return res.status(404).json({ error: `Package "${machineName}" not found on disk` });
    }

    // Check if already installed
    const checkClient = await pool.connect();
    try {
      const result = await checkClient.query(
        `SELECT package FROM genrpg.packages WHERE package = $1`,
        [machineName],
      );
      if (result.rows.length > 0) {
        return res.status(400).json({ error: `Package "${machineName}" is already installed` });
      }
    } finally {
      checkClient.release();
    }

    // Create the package schema
    const schemaClient = await pool.connect();
    try {
      await schemaClient.query(`CREATE SCHEMA IF NOT EXISTS "${machineName}"`);
    } finally {
      schemaClient.release();
    }

    // Apply schema versions (runs SQL files)
    await applySchemaVersions({ pool });

    // Apply update steps
    await applyPackageUpdatesForMachine(pool, machineName);

    // Ensure the package is registered in genrpg.packages even if it had
    // no SQL files or update steps — this is what marks it as "installed".
    const { loadUpdatesModule, getLatestVersion } = require("../updates");
    const updatesModule = await loadUpdatesModule(pkg.machineName, pkg.path);
    const latestVersion = getLatestVersion(updatesModule);
    const registerClient = await pool.connect();
    try {
      await registerClient.query(
        `
          INSERT INTO genrpg.packages (package, version)
          VALUES ($1, $2)
          ON CONFLICT (package) DO UPDATE SET version = EXCLUDED.version
        `,
        [machineName, latestVersion],
      );
    } finally {
      registerClient.release();
    }

    invalidatePackageCache();

    res.json({ success: true });
  } catch (error) {
    if (error instanceof PackageLoadError) {
      res.status(error.status).json({ error: error.message, details: error.details });
      return;
    }

    next(error);
  }
});

packagesRouter.post("/update", requireAdmin, async (req, res, next) => {
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

module.exports = packagesRouter;
