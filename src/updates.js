const fs = require("node:fs/promises");
const path = require("node:path");

const { loadPackages, sortPackagesByDependencies } = require("./packages");
const { applySchemaVersions, applyPendingSchemaVersionsForPackage } = require("./db/versions");
const { applyGlobalPackageInstalls } = require("./install");
const { createSchemaQuery, insertQuery, selectQuery } = require("./services/queryService");
const { HttpError } = require("./errors/HttpError");

const REPO_ROOT = path.join(__dirname, "..");

class PackageUpdateError extends HttpError {
  constructor(message, details = []) {
    super(500, message, details.length ? details : null);
    this.name = "PackageUpdateError";
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

function getLatestVersion(updatesModule) {
  if (!updatesModule || typeof updatesModule !== "object") return 0;

  const versions = Object.keys(updatesModule)
    .map((key) => Number(key))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (!versions.length) return 0;
  return Math.max(...versions);
}

async function getAppliedVersions(client) {
  const tableAlias = "p";
  const query = selectQuery()
    .from("genrpg", "packages", tableAlias)
    .addFields(tableAlias, ["machine_name", "version"]);

  const result = await client.query(query.toString(), query.params);
  return new Map(result.rows.map((row) => [row.machine_name, row.version]));
}

async function setAppliedVersion(client, machineName, version) {
  const query = insertQuery()
    .into("genrpg", "packages")
    .values(["machine_name", "version"], [machineName, version])
    .onConflict(["machine_name"], "DO UPDATE");

  await client.query(query.toString(), query.params);
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

async function applyPackageUpdatesForMachine(pool, machineName) {
  const packages = await loadPackages({ strict: false });
  const pkg = packages.find((entry) => entry.machineName === machineName);
  if (!pkg) {
    return { applied: [] };
  }

  const schemaApplied = await applyPendingSchemaVersionsForPackage({
    pool,
    packageName: machineName,
  });

  if (pkg.machineName) {
    const client = await pool.connect();
    try {
      await client.query(createSchemaQuery(pkg.machineName));
    } finally {
      client.release();
    }
  }

  const updatesModule = await loadUpdatesModule(pkg.machineName, pkg.path);
  const latestVersion = getLatestVersion(updatesModule);
  if (!latestVersion) {
    return { applied: schemaApplied.applied };
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
    return { applied: schemaApplied.applied };
  }

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
  const packages = await loadPackages({ strict: false });
  const appliedVersions = await getAppliedVersions(client);
  const statuses = [];

  for (const pkg of packages) {
    const updatesModule = await loadUpdatesModule(pkg.machineName, pkg.path);
    const latestVersion = getLatestVersion(updatesModule);
    const currentVersion = appliedVersions.get(pkg.machineName) ?? 0;

    statuses.push({
      machineName: pkg.machineName,
      currentVersion,
      latestVersion,
    });
  }

  const updatesNeeded = statuses.some(
    (status) => status.currentVersion < status.latestVersion,
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

  const packages = await loadPackages({ strict: false });
  const orderedPackages = sortPackagesByDependencies(packages);
  const applied = [];

  for (const pkg of orderedPackages) {
    if (pkg.machineName) {
      const client = await pool.connect();
      try {
        await client.query(createSchemaQuery(pkg.machineName));
      } finally {
        client.release();
      }
    }

    const updatesModule = await loadUpdatesModule(pkg.machineName, pkg.path);
    const latestVersion = getLatestVersion(updatesModule);
    if (!latestVersion) continue;

    let currentVersion = 0;
    const readClient = await pool.connect();
    try {
      const appliedVersions = await getAppliedVersions(readClient);
      currentVersion = appliedVersions.get(pkg.machineName) ?? 0;
    } finally {
      readClient.release();
    }

    if (currentVersion >= latestVersion) {
      continue;
    }

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

  const installApplied = await applyGlobalPackageInstalls(pool, orderedPackages);

  return { updatesNeeded: false, applied, installApplied };
}

module.exports = {
  checkPackageUpdates,
  applyPackageUpdates,
  applyPackageUpdatesForMachine,
  loadUpdatesModule,
  getLatestVersion,
};
