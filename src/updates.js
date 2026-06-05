const fs = require("node:fs/promises");
const path = require("node:path");

const { loadPackages } = require("./packages");
const { applySchemaVersions, applyPendingSchemaVersionsForPackage } = require("./db/versions");

const REPO_ROOT = path.join(__dirname, "..");

class PackageUpdateError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "PackageUpdateError";
    this.details = details;
    this.status = 500;
  }
}

function getUpdatesPath(machineName, packagePath) {
  if (machineName === "genrpg") {
    return path.join(REPO_ROOT, "genrpg", "genrpg.updates.js");
  }

  return path.join(REPO_ROOT, packagePath, `${machineName}.updates.js`);
}

async function loadUpdatesModule(machineName, packagePath) {
  const updatesPath = getUpdatesPath(machineName, packagePath);

  try {
    await fs.access(updatesPath);
  } catch {
    return null;
  }

  const modulePath = path.resolve(updatesPath);
  try {
    delete require.cache[require.resolve(modulePath)];
  } catch {
    // Module was not loaded yet; nothing to clear.
  }
  const loaded = require(modulePath);
  return typeof loaded === "function" && loaded.default ? loaded.default : loaded;
}

const UPDATE_STEP_KEY_PATTERN = /^\s+(\d+)\s*:/gm;

function getLatestVersion(updatesModule) {
  if (!updatesModule || typeof updatesModule !== "object") return 0;

  const versions = Object.keys(updatesModule)
    .map((key) => Number(key))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (!versions.length) return 0;
  return Math.max(...versions);
}

async function getLatestVersionFromDisk(machineName, packagePath) {
  const updatesPath = getUpdatesPath(machineName, packagePath);

  let content;
  try {
    content = await fs.readFile(updatesPath, "utf8");
  } catch {
    return 0;
  }

  const versions = [...content.matchAll(UPDATE_STEP_KEY_PATTERN)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (!versions.length) return 0;
  return Math.max(...versions);
}

async function resolveLatestPackageVersion(machineName, packagePath) {
  const updatesModule = await loadUpdatesModule(machineName, packagePath);
  const fromModule = getLatestVersion(updatesModule);
  const fromDisk = await getLatestVersionFromDisk(machineName, packagePath);
  return Math.max(fromModule, fromDisk);
}

async function getPackageUpdateDiagnostics(machineName, packagePath) {
  const updatesPath = getUpdatesPath(machineName, packagePath);
  const updatesModule = await loadUpdatesModule(machineName, packagePath);

  return {
    updatesPath: path.relative(REPO_ROOT, updatesPath),
    latestVersionDisk: await getLatestVersionFromDisk(machineName, packagePath),
    latestVersionModule: getLatestVersion(updatesModule),
    latestVersion: await resolveLatestPackageVersion(machineName, packagePath),
  };
}

function sortPackagesByDependencies(packages) {
  const byMachineName = new Map(packages.map((pkg) => [pkg.machineName, pkg]));
  const sorted = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(machineName) {
    if (visited.has(machineName)) return;
    if (visiting.has(machineName)) {
      throw new PackageUpdateError("Invalid package configuration", [
        `Circular package requirement involving "${machineName}"`,
      ]);
    }

    visiting.add(machineName);
    const pkg = byMachineName.get(machineName);
    if (pkg) {
      for (const requirement of pkg.requirements) {
        visit(requirement.machineName);
      }
    }
    visiting.delete(machineName);
    visited.add(machineName);

    if (pkg) sorted.push(pkg);
  }

  for (const pkg of packages) {
    visit(pkg.machineName);
  }

  return sorted;
}

async function getAppliedVersions(client) {
  const result = await client.query(`SELECT package, version FROM genrpg.packages`);
  return new Map(result.rows.map((row) => [row.package, row.version]));
}

async function setAppliedVersion(client, machineName, version) {
  await client.query(
    `
      INSERT INTO genrpg.packages (package, version)
      VALUES ($1, $2)
      ON CONFLICT (package)
      DO UPDATE SET version = EXCLUDED.version
    `,
    [machineName, version],
  );
}

async function runVersionStep(client, updatesModule, version) {
  const step = updatesModule[version];
  if (typeof step !== "function") {
    throw new PackageUpdateError("Invalid package update", [
      `Update version ${version} is not a function`,
    ]);
  }

  await step(client);
}

async function runMaintenanceSteps(pool, machineName, packagePath) {
  const updatesModule = await loadUpdatesModule(machineName, packagePath);
  const steps = updatesModule.maintenance;
  if (!Array.isArray(steps) || !steps.length) {
    return false;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const step of steps) {
      if (typeof step === "function") {
        await step(client);
      }
    }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function packageNeedsMaintenance(client, pkg) {
  const updatesModule = await loadUpdatesModule(pkg.machineName, pkg.path);
  if (typeof updatesModule.needsMaintenance !== "function") {
    return false;
  }

  return updatesModule.needsMaintenance(client);
}

async function applyPackageUpdatesForMachine(pool, machineName) {
  const { packages } = await loadPackages({ strict: false });
  const pkg = packages.find((entry) => entry.machineName === machineName);
  if (!pkg) {
    return { applied: [] };
  }

  const schemaApplied = await applyPendingSchemaVersionsForPackage({
    pool,
    packageName: machineName,
  });

  const maintenanceRan = await runMaintenanceSteps(pool, pkg.machineName, pkg.path);

  if (pkg.machineName) {
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${pkg.machineName}"`);
    } finally {
      client.release();
    }
  }

  const latestVersion = await resolveLatestPackageVersion(pkg.machineName, pkg.path);
  if (!latestVersion) {
    return {
      applied: maintenanceRan
        ? [...schemaApplied.applied, { machineName: pkg.machineName, maintenance: true }]
        : schemaApplied.applied,
    };
  }

  let currentVersion = 0;
  const readClient = await pool.connect();
  try {
    const appliedVersions = await getAppliedVersions(readClient);
    currentVersion = appliedVersions.get(pkg.machineName) ?? 0;
  } finally {
    readClient.release();
  }

  if (currentVersion >= latestVersion) {
    return {
      applied: maintenanceRan
        ? [...schemaApplied.applied, { machineName: pkg.machineName, maintenance: true }]
        : schemaApplied.applied,
    };
  }

  const updatesModule = await loadUpdatesModule(pkg.machineName, pkg.path);

  for (let version = currentVersion + 1; version <= latestVersion; version += 1) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await runVersionStep(client, updatesModule, version);
      await setAppliedVersion(client, pkg.machineName, version);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    applied: [
      ...schemaApplied.applied,
      {
        machineName: pkg.machineName,
        fromVersion: currentVersion,
        toVersion: latestVersion,
      },
    ],
  };
}

async function buildUpdateStatus(client) {
  const { packages } = await loadPackages({ strict: false });
  const appliedVersions = await getAppliedVersions(client);
  const statuses = [];

  for (const pkg of packages) {
    const diagnostics = await getPackageUpdateDiagnostics(pkg.machineName, pkg.path);
    const currentVersion = appliedVersions.get(pkg.machineName) ?? 0;
    const maintenanceNeeded = await packageNeedsMaintenance(client, pkg);

    statuses.push({
      machineName: pkg.machineName,
      currentVersion,
      latestVersion: diagnostics.latestVersion,
      latestVersionDisk: diagnostics.latestVersionDisk,
      latestVersionModule: diagnostics.latestVersionModule,
      updatesPath: diagnostics.updatesPath,
      maintenanceNeeded,
    });
  }

  const updatesNeeded = statuses.some(
    (status) => status.currentVersion < status.latestVersion || status.maintenanceNeeded,
  );
  return { updatesNeeded, packages: statuses };
}

async function checkPackageUpdates(pool) {
  const client = await pool.connect();
  try {
    return await buildUpdateStatus(client);
  } finally {
    client.release();
  }
}

async function applyPackageUpdates(pool) {
  await applySchemaVersions({ pool });

  const { packages } = await loadPackages({ strict: false });
  const orderedPackages = sortPackagesByDependencies(packages);
  const applied = [];

  for (const pkg of orderedPackages) {
    if (pkg.machineName) {
      const client = await pool.connect();
      try {
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${pkg.machineName}"`);
      } finally {
        client.release();
      }
    }

    const latestVersion = await resolveLatestPackageVersion(pkg.machineName, pkg.path);
    if (!latestVersion) continue;

    let currentVersion = 0;
    const readClient = await pool.connect();
    try {
      const appliedVersions = await getAppliedVersions(readClient);
      currentVersion = appliedVersions.get(pkg.machineName) ?? 0;
    } finally {
      readClient.release();
    }

    const maintenanceRan = await runMaintenanceSteps(pool, pkg.machineName, pkg.path);

    if (currentVersion >= latestVersion) {
      if (maintenanceRan) {
        applied.push({ machineName: pkg.machineName, maintenance: true });
      }
      continue;
    }

    const updatesModule = await loadUpdatesModule(pkg.machineName, pkg.path);

    for (let version = currentVersion + 1; version <= latestVersion; version += 1) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await runVersionStep(client, updatesModule, version);
        await setAppliedVersion(client, pkg.machineName, version);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    applied.push({
      machineName: pkg.machineName,
      fromVersion: currentVersion,
      toVersion: latestVersion,
    });
  }

  return { updatesNeeded: false, applied };
}

module.exports = {
  PackageUpdateError,
  checkPackageUpdates,
  applyPackageUpdates,
  applyPackageUpdatesForMachine,
  getPackageUpdateDiagnostics,
  loadUpdatesModule,
  getLatestVersion,
  getLatestVersionFromDisk,
  resolveLatestPackageVersion,
};
