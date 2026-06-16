const fs = require("node:fs/promises");
const path = require("node:path");

const { pool } = require("./db/pool");
const { withTransaction, getTransactionClient } = require("./db/transactionContext");
const { insertQuery, selectQuery } = require("./services/queryService");
const {
  loadPackages,
  REPO_ROOT,
  parsePackageCsv,
  expandInstancePackageSelection,
  resolveInstancePackages,
  sortPackagesByDependencies,
} = require("./packages");
const {
  createInstallRefRegistry,
  loadSeedJson,
} = require("./lib/seedImport");

class PackageInstallError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [details]
   */
  constructor(message, details = []) {
    super(message);
    this.name = "PackageInstallError";
    this.details = details;
  }
}

/**
 * @param {string} machineName
 * @param {string} packagePath
 * @returns {string}
 */
function getInstallPath(machineName, packagePath) {
  if (machineName === "genrpg") {
    return path.join(REPO_ROOT, "genrpg", "genrpg.install.js");
  }

  return path.join(REPO_ROOT, packagePath, `${machineName}.install.js`);
}

/**
 * @param {string} machineName
 * @param {string} packagePath
 */
async function loadInstallModule(machineName, packagePath) {
  const installPath = getInstallPath(machineName, packagePath);

  try {
    await fs.access(installPath);
  } catch {
    return null;
  }

  const modulePath = path.resolve(installPath);
  try {
    delete require.cache[require.resolve(modulePath)];
  } catch {
    // Module was not loaded yet.
  }

  const loaded = require(modulePath);
  return typeof loaded === "function" && loaded.default ? loaded.default : loaded;
}

/**
 * @param {object | null} installModule
 * @param {"global" | "instance"} scope
 * @returns {number}
 */
function getLatestInstallVersion(installModule, scope) {
  if (!installModule || typeof installModule !== "object") {
    return 0;
  }

  const steps = installModule[scope];
  if (!steps || typeof steps !== "object") {
    return 0;
  }

  const versions = Object.keys(steps)
    .map((key) => Number(key))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (!versions.length) {
    return 0;
  }

  return Math.max(...versions);
}

/**
 * @param {import("pg").Pool} pool
 * @returns {Promise<Map<string, number>>}
 */
async function getGlobalInstallVersions(pool) {
  const client = await pool.connect();
  try {
    const query = selectQuery()
      .from("genrpg", "packages", "p")
      .addFields("p", ["package", "install_version"]);

    const result = await client.query(query.toString(), query.params);
    return new Map(result.rows.map((row) => [row.package, row.install_version ?? 0]));
  } finally {
    client.release();
  }
}

/**
 * @param {import("pg").PoolClient} client
 * @param {string} machineName
 * @param {number} installVersion
 */
async function setGlobalInstallVersion(client, machineName, installVersion) {
  const query = insertQuery()
    .into("genrpg", "packages")
    .values(["package", "install_version"], [machineName, installVersion])
    .onConflict(["package"], "DO UPDATE");

  await client.query(query.toString(), query.params);
}

/**
 * @param {import("pg").PoolClient} client
 * @param {string} instanceGuid
 * @param {string} machineName
 * @returns {Promise<number>}
 */
async function getInstanceInstallVersion(client, instanceGuid, machineName) {
  const tableAlias = "ipi";
  const query = selectQuery()
    .from("genrpg", "instance_package_install", tableAlias)
    .addFields(tableAlias, "install_version")
    .whereColumn(tableAlias, "instance_guid", instanceGuid)
    .whereColumn(tableAlias, "package", machineName);

  const result = await client.query(query.toString(), query.params);
  return result.rows[0]?.install_version ?? 0;
}

/**
 * @param {import("pg").PoolClient} client
 * @param {string} instanceGuid
 * @param {string} machineName
 * @param {number} installVersion
 */
async function setInstanceInstallVersion(client, instanceGuid, machineName, installVersion) {
  const query = insertQuery()
    .into("genrpg", "instance_package_install")
    .values(["instance_guid", "package", "install_version"], [instanceGuid, machineName, installVersion])
    .onConflict(["instance_guid", "package"], "DO UPDATE");

  await client.query(query.toString(), query.params);
}

/**
 * @param {object} pkg package manifest entry from loadPackages()
 * @param {{
 *   instance?: { guid: string, packages: Record<string, string> } | null,
 *   refs?: ReturnType<typeof createInstallRefRegistry>,
 * }} [options]
 */
function createInstallContext(pkg, { instance = null, refs = null } = {}) {
  const packageDir = path.join(REPO_ROOT, pkg.path);
  const refRegistry = refs ?? createInstallRefRegistry();

  return {
    package: pkg,
    packageDir,
    instance,
    loadSeedJson: (relativePath) => loadSeedJson(packageDir, relativePath),
    ...refRegistry,
  };
}

/**
 * @param {object} installModule
 * @param {"global" | "instance"} scope
 * @param {number} version
 * @param {ReturnType<typeof createInstallContext>} ctx
 */
async function runInstallStep(installModule, scope, version, ctx) {
  const steps = installModule?.[scope];
  const step = steps?.[version];

  if (typeof step !== "function") {
    throw new PackageInstallError("Invalid package install step", [
      `${ctx.package.machineName}: ${scope} step ${version} is not a function`,
    ]);
  }

  await step(ctx);
}

/**
 * Run pending install steps for one package and scope.
 *
 * @param {object} pkg package manifest entry
 * @param {"global" | "instance"} scope
 * @param {{
 *   installVersions?: Map<string, number>,
 *   instance?: { guid: string, packages: Record<string, string> },
 * }} context
 * @returns {Promise<object | null>} install record when steps ran, otherwise null
 */
async function applyInstallStepsForPackage(pkg, scope, { installVersions, instance } = {}) {
  const installModule = await loadInstallModule(pkg.machineName, pkg.path);
  const latestStepVersion = getLatestInstallVersion(installModule, scope);
  if (!latestStepVersion) {
    return null;
  }

  let installedVersion = 0;
  if (scope === "global") {
    installedVersion = installVersions?.get(pkg.machineName) ?? 0;
  } else {
    if (!instance?.guid) {
      throw new Error("Instance install requires instance.guid");
    }
    const readClient = await pool.connect();
    try {
      installedVersion = await getInstanceInstallVersion(readClient, instance.guid, pkg.machineName);
    } finally {
      readClient.release();
    }
  }

  if (installedVersion >= latestStepVersion) {
    return null;
  }

  const refRegistry = createInstallRefRegistry();

  for (let stepVersion = installedVersion + 1; stepVersion <= latestStepVersion; stepVersion += 1) {
    await withTransaction(async () => {
      const ctx = createInstallContext(pkg, { instance, refs: refRegistry });
      await runInstallStep(installModule, scope, stepVersion, ctx);
      const client = getTransactionClient();
      if (!client) {
        throw new Error("Package install step must run inside withTransaction()");
      }
      if (scope === "global") {
        await setGlobalInstallVersion(client, pkg.machineName, stepVersion);
      } else {
        await setInstanceInstallVersion(client, instance.guid, pkg.machineName, stepVersion);
      }
    });
  }

  const record = {
    machineName: pkg.machineName,
    scope,
    fromVersion: installedVersion,
    toVersion: latestStepVersion,
  };
  if (scope === "instance") {
    record.instanceGuid = instance.guid;
  }
  return record;
}

/**
 * Run pending global install steps for installed packages in the given order.
 *
 * @param {import("pg").Pool} pool
 * @param {object[]} packages dependency-ordered package list (typically from applyPackageUpdates)
 * @returns {Promise<object[]>} install records for packages that ran steps this call
 */
async function applyGlobalPackageInstalls(pool, packages) {
  const installVersions = await getGlobalInstallVersions(pool);
  const installedNames = new Set(installVersions.keys());

  const installApplied = [];
  for (const pkg of packages) {
    if (!installedNames.has(pkg.machineName)) {
      continue;
    }

    const record = await applyInstallStepsForPackage(pkg, "global", { installVersions });
    if (record) {
      installApplied.push(record);
    }
  }

  return installApplied;
}

/**
 * @param {import("pg").Pool} pool
 * @param {string} machineName
 * @returns {Promise<object | null>} install record when steps ran, otherwise null
 */
async function applyGlobalInstallForMachine(pool, machineName) {
  const installVersions = await getGlobalInstallVersions(pool);
  if (!installVersions.has(machineName)) {
    return null;
  }

  const packages = await loadPackages({ strict: false, packageNames: [machineName] });
  const pkg = packages[0];
  if (!pkg) {
    return null;
  }

  return applyInstallStepsForPackage(pkg, "global", { installVersions });
}

/**
 * Run instance-scoped install steps for all packages on a newly created instance.
 *
 * @param {string} instanceGuid
 * @param {string} packageCsv
 * @returns {Promise<object[]>}
 */
async function applyInstallForInstance(instanceGuid, packageCsv) {
  // Full catalog required so expandInstancePackageSelection can walk requirement edges.
  const allPackages = await loadPackages({ strict: false });
  const expandedNames = expandInstancePackageSelection(parsePackageCsv(packageCsv), allPackages);
  const orderedPackages = sortPackagesByDependencies(
    allPackages.filter((pkg) => expandedNames.includes(pkg.machineName)),
  );
  const instance = {
    guid: instanceGuid,
    packages: resolveInstancePackages(packageCsv, allPackages),
  };

  const installApplied = [];

  for (const pkg of orderedPackages) {
    const record = await applyInstallStepsForPackage(pkg, "instance", { instance });
    if (record) {
      installApplied.push(record);
    }
  }

  return installApplied;
}

module.exports = {
  applyGlobalPackageInstalls,
  applyGlobalInstallForMachine,
  applyInstallForInstance,
};
