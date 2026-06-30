const crypto = require("node:crypto");
const path = require("node:path");
const os = require("node:os");
const { exec } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const semver = require("semver");
const express = require("express");

const { pool } = require("../db/pool");
const { syncDatabase } = require("../db/dbSync");
const { requireAdmin } = require("../auth");
const { parseYaml, readYamlFile } = require("../lib/yamlFile");
const { insertQuery, selectQuery } = require("../services/queryService");
const { asyncRoute } = require("../lib/httpResponse");
const {
  loadPackages,
  getPackageConfigurationIssues,
} = require("../packages");
const { invalidateApplicationCaches } = require("../services/cacheService");
const {
  applyPackageUpdates,
  applyPackageUpdatesForMachine,
  checkPackageUpdates,
  loadUpdatesModule,
  getLatestVersion,
} = require("../updates");
const { applyGlobalInstallForMachine } = require("../install");

const execAsync = promisify(exec);

const packagesRouter = express.Router();

async function registerPackageVersion(machineName) {
  const registerClient = await pool.connect();
  try {
    const registerQuery = insertQuery()
      .into("genrpg", "packages")
      .values(["machine_name", "version"], [machineName, 0])
      .onConflict(["machine_name"], "DO NOTHING");

    await registerClient.query(registerQuery.toString(), registerQuery.params);
  } finally {
    registerClient.release();
  }
}

async function applyPackageDatabase(machineName, packagePath, { reinstall = false } = {}) {
  let updateWarning = null;
  try {
    await syncDatabase({ pool, packageNames: [machineName] });
    await applyPackageUpdatesForMachine(pool, machineName);
    await registerPackageVersion(machineName);
    const installApplied = await applyGlobalInstallForMachine(pool, machineName);
    if (installApplied) {
      console.log(
        `Applied global install for ${machineName}: v${installApplied.fromVersion} → v${installApplied.toVersion}`,
      );
    }
  } catch (error) {
    console.error(`Failed to apply database for ${machineName}:`, error);
    updateWarning = error.message || "Failed to apply package database updates";
  }

  if (!updateWarning) {
    const updatesModule = await loadUpdatesModule(machineName, packagePath);
    const latestVersion = getLatestVersion(updatesModule);
    if (latestVersion) {
      const versionClient = await pool.connect();
      try {
        const tableAlias = "p";
        const versionQuery = selectQuery()
          .from("genrpg", "packages", tableAlias)
          .addFields(tableAlias, "version")
          .whereColumn(tableAlias, "machine_name", machineName);

        const applied = await versionClient.query(versionQuery.toString(), versionQuery.params);
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

packagesRouter.get("/packages", asyncRoute(async (req, res) => {
  res.json({
    packages: await loadPackages({ strict: false, withRegistry: true }),
    configurationIssues: getPackageConfigurationIssues(),
  });
}));

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
    
    const raw = await readYamlFile(path.join(tmpDir, manifestFile));
    
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

packagesRouter.get("/packages/git/status", requireAdmin, asyncRoute(async (req, res) => {
  const packages = await loadPackages({ strict: false, withRegistry: true });
  const configurationIssues = getPackageConfigurationIssues();

  const statuses = [];

  for (const pkg of packages) {
    if (pkg.machineName === "genrpg") continue;

    const { name, installed, machineName, version, path: packagePath } = pkg;
    const pkgPath = path.join(__dirname, "..", "..", packagePath);

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
        name,
        machineName,
        localVersion: version,
        remoteVersion: version,
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

      const { stdout: manifestContent } = await execAsync(`git show ${branchRef}:${machineName}.package.yml`, { cwd: pkgPath });
      const raw = parseYaml(manifestContent);
      const remoteVersion = raw.version || "0.0.0";

      const canUpdate = semver.valid(remoteVersion) && semver.valid(version)
                        ? semver.gt(remoteVersion, version)
                        : false;

      statuses.push({
        name,
        machineName,
        localVersion: version,
        remoteVersion,
        url,
        canUpdate,
        installed,
      });
    } catch (err) {
      console.error(`Failed to get git status for ${machineName}:`, err);
      // Still include the package so it can be installed even if git status fails
      statuses.push({
        name,
        machineName,
        localVersion: version,
        remoteVersion: version,
        url: "",
        canUpdate: false,
        installed,
      });
    }
  }

  res.json({ statuses, configurationIssues });
}));

packagesRouter.post("/packages/git/preview", requireAdmin, async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "Repository URL is required" });
    }
    
    const preview = await previewGitPackage(url);

    const packages = await loadPackages({ strict: false });
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
      await execAsync(`git remote set-url origin "${url}"`, { cwd: targetDir });
      await execAsync("git fetch origin", { cwd: targetDir });
      await execAsync("git pull --ff-only", { cwd: targetDir });
    } catch (accessError) {
      if (accessError?.code !== "ENOENT") {
        throw accessError;
      }
      await execAsync(`git clone "${url}" "${targetDir}"`);
    }

    let updateWarning = null;
    try {
      await syncDatabase({ pool });
      await applyPackageUpdatesForMachine(pool, preview.machineName);
    } catch (error) {
      console.error(`Failed to apply DB updates for ${preview.machineName}:`, error);
      updateWarning = error.message || "Failed to apply package database updates";
    }

    await invalidateApplicationCaches();

    await loadPackages({ strict: false });

    res.json({
      success: true,
      configurationIssues: getPackageConfigurationIssues(),
      updateWarning,
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to pull package" });
  }
});

packagesRouter.post("/packages/install", requireAdmin, asyncRoute(async (req, res) => {
  const { machineName } = req.body;
  if (!machineName || typeof machineName !== "string") {
    res.status(400).json({ error: "machineName is required" });
    return;
  }

  const packages = await loadPackages({ strict: false });
  const pkg = packages.find((p) => p.machineName === machineName);
  if (!pkg) {
    res.status(404).json({ error: `Package "${machineName}" not found on disk` });
    return;
  }

  const installedQuery = selectQuery()
    .from("genrpg", "packages", "p")
    .addFields("p", "machine_name")
    .whereColumn("p", "machine_name", machineName);
  const installedResult = await pool.query(installedQuery.toString(), installedQuery.params);
  if (installedResult.rows.length > 0) {
    res.status(400).json({ error: `Package "${machineName}" is already installed` });
    return;
  }

  const { updateWarning } = await applyPackageDatabase(machineName, pkg.path);
  await invalidateApplicationCaches();

  res.json({ success: true, updateWarning });
}));

packagesRouter.post("/packages/reinstall", requireAdmin, asyncRoute(async (req, res) => {
  const { machineName } = req.body;
  if (!machineName || typeof machineName !== "string") {
    res.status(400).json({ error: "machineName is required" });
    return;
  }

  if (machineName === "genrpg") {
    res.status(400).json({ error: "The genrpg package cannot be reinstalled from this action" });
    return;
  }

  const packages = await loadPackages({ strict: false });
  const pkg = packages.find((p) => p.machineName === machineName);
  if (!pkg) {
    res.status(404).json({ error: `Package "${machineName}" not found on disk` });
    return;
  }

  const { updateWarning } = await applyPackageDatabase(machineName, pkg.path, { reinstall: true });
  await invalidateApplicationCaches();

  res.json({ success: true, updateWarning });
}));

packagesRouter.post("/update", requireAdmin, asyncRoute(async (req, res) => {
  if (req.body?.update === true) {
    await syncDatabase({ pool });
    res.json(await applyPackageUpdates(pool));
    return;
  }

  res.json(await checkPackageUpdates(pool));
}));

module.exports = packagesRouter;
