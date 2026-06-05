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
const { applySchemaVersions, reapplyPackageSchemaVersions } = require("../db/versions");
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
  getPackageUpdateDiagnostics,
  resolveLatestPackageVersion,
} = require("../updates");

const execAsync = promisify(exec);

const packagesRouter = express.Router();

async function registerPackageVersion(machineName) {
  const registerClient = await pool.connect();
  try {
    await registerClient.query(
      `
        INSERT INTO genrpg.packages (package, version)
        VALUES ($1, 0)
        ON CONFLICT (package) DO NOTHING
      `,
      [machineName],
    );
  } finally {
    registerClient.release();
  }
}

async function applyPackageDatabase(machineName, packagePath, { reinstall = false } = {}) {
  const schemaClient = await pool.connect();
  try {
    await schemaClient.query(`CREATE SCHEMA IF NOT EXISTS "${machineName}"`);
  } finally {
    schemaClient.release();
  }

  let updateWarning = null;
  try {
    if (reinstall) {
      await reapplyPackageSchemaVersions({ pool, packageName: machineName });
    } else {
      await applySchemaVersions({ pool });
    }
    await applyPackageUpdatesForMachine(pool, machineName);
  } catch (error) {
    console.error(`Failed to apply database for ${machineName}:`, error);
    updateWarning = error.message || "Failed to apply package database updates";
  }

  await registerPackageVersion(machineName);

  if (!updateWarning) {
    const latestVersion = await resolveLatestPackageVersion(machineName, packagePath);
    if (latestVersion) {
      const versionClient = await pool.connect();
      try {
        const applied = await versionClient.query(
          `SELECT version FROM genrpg.packages WHERE package = $1`,
          [machineName],
        );
        const currentVersion = applied.rows[0]?.version ?? 0;
        if (currentVersion < latestVersion) {
          updateWarning =
            "Package database update steps did not reach the latest version. Use the Update banner on the home page.";
        }
      } finally {
        versionClient.release();
      }
    }
  }

  return { updateWarning };
}

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
    
    let gitHead = null;
    try {
      await fs.access(targetDir);
      await execAsync(`git remote set-url origin "${url}"`, { cwd: targetDir });
      await execAsync("git fetch origin", { cwd: targetDir });
      await execAsync("git pull --ff-only", { cwd: targetDir });
      const { stdout } = await execAsync("git rev-parse --short HEAD", { cwd: targetDir });
      gitHead = stdout.trim();
    } catch (accessError) {
      if (accessError?.code !== "ENOENT") {
        throw accessError;
      }
      await execAsync(`git clone "${url}" "${targetDir}"`);
      const { stdout } = await execAsync("git rev-parse --short HEAD", { cwd: targetDir });
      gitHead = stdout.trim();
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

    const packagePath = path.posix.join("packages", preview.machineName);
    const packageUpdate = await getPackageUpdateDiagnostics(preview.machineName, packagePath);
    const { configurationIssues } = await loadPackages({ strict: false });

    res.json({
      success: true,
      configurationIssues,
      updateWarning,
      gitHead,
      packageUpdate,
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

    const { updateWarning } = await applyPackageDatabase(machineName, pkg.path);
    invalidatePackageCache();

    res.json({ success: true, updateWarning });
  } catch (error) {
    if (error instanceof PackageLoadError) {
      res.status(error.status).json({ error: error.message, details: error.details });
      return;
    }

    next(error);
  }
});

packagesRouter.post("/packages/reinstall", requireAdmin, async (req, res, next) => {
  try {
    const { machineName } = req.body;
    if (!machineName || typeof machineName !== "string") {
      return res.status(400).json({ error: "machineName is required" });
    }

    if (machineName === "genrpg") {
      return res.status(400).json({ error: "The genrpg package cannot be reinstalled from this action" });
    }

    const { packages } = await loadPackages({ strict: false });
    const pkg = packages.find((p) => p.machineName === machineName);
    if (!pkg) {
      return res.status(404).json({ error: `Package "${machineName}" not found on disk` });
    }

    const { updateWarning } = await applyPackageDatabase(machineName, pkg.path, { reinstall: true });
    invalidatePackageCache();

    res.json({ success: true, updateWarning });
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
