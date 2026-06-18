const fs = require("node:fs/promises");
const path = require("node:path");

const { pool } = require("./db/pool");
const { withTransaction, getTransactionClient } = require("./db/transactionContext");
const { insertQuery, selectQuery } = require("./services/queryService");
const {
  loadPackages,
  REPO_ROOT,
  sortPackagesByDependencies,
} = require("./packages");
const {
  createInstallRefRegistry,
  loadSeedJson,
} = require("./lib/seedImport");
const PackageStorage = require("./storage/packageStorage");

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
      .addFields("p", ["machine_name", "install_version"]);

    const result = await client.query(query.toString(), query.params);
    return new Map(result.rows.map((row) => [row.machine_name, row.install_version ?? 0]));
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
    .values(["machine_name", "install_version"], [machineName, installVersion])
    .onConflict(["machine_name"], "DO UPDATE");

  await client.query(query.toString(), query.params);
}

/**
 * @param {object} pkg package manifest entry from loadPackages()
 * @param {{
 *   instance?: import("../genrpg/entities/instance") | null,
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
 *   instance?: import("../genrpg/entities/instance"),
 *   packageGuid?: string,
 * }} context
 * @returns {Promise<object | null>} install record when steps ran, otherwise null
 */
async function applyInstallStepsForPackage(pkg, scope, { installVersions, instance, packageGuid } = {}) {
  const installModule = await loadInstallModule(pkg.machineName, pkg.path);
  const latestStepVersion = getLatestInstallVersion(installModule, scope);
  if (!latestStepVersion) {
    return null;
  }

  let installedVersion = 0;
  let packageInstallEntry;
  if (scope === "global") {
    installedVersion = installVersions?.get(pkg.machineName) ?? 0;
  } else {
    if (!instance?.guid) {
      throw new Error("Instance install requires instance.guid");
    }
    if (!packageGuid) {
      throw new Error("Instance install requires packageGuid");
    }
    packageInstallEntry = (instance.packages ?? []).find((entry) => entry.packageGuid === packageGuid);
    if (!packageInstallEntry) {
      throw new Error(`Instance ${instance.guid} has no install row for package ${packageGuid}`);
    }
    installedVersion = packageInstallEntry.installVersion ?? 0;
  }

  if (installedVersion >= latestStepVersion) {
    return null;
  }

  const refRegistry = createInstallRefRegistry();

  for (let stepVersion = installedVersion + 1; stepVersion <= latestStepVersion; stepVersion += 1) {
    await withTransaction(async () => {
      const ctx = createInstallContext(pkg, { instance, refs: refRegistry });
      await runInstallStep(installModule, scope, stepVersion, ctx);
      if (scope === "global") {
        const client = getTransactionClient();
        if (!client) {
          throw new Error("Package install step must run inside withTransaction()");
        }
        await setGlobalInstallVersion(client, pkg.machineName, stepVersion);
      } else {
        packageInstallEntry.installVersion = stepVersion;
        await instance.save({ skipEvents: true });
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
 * Run pending instance-scoped install steps for packages selected on the instance.
 *
 * @param {import("../genrpg/entities/instance")} instance
 * @param {object[]} catalog disk package catalog
 */
async function applyInstallForInstance(instance, catalog) {
  const packageGuids = (instance.packages ?? []).map((entry) => entry.packageGuid).filter(Boolean);
  if (!packageGuids.length) {
    return;
  }

  const packages = await PackageStorage.global().load(packageGuids, { skipEvents: true });
  const packagesByMachineName = new Map();
  for (const pkg of packages) {
    packagesByMachineName.set(pkg.machineName, pkg);
  }

  const orderedPackages = sortPackagesByDependencies(
    catalog.filter(({ machineName }) => packagesByMachineName.has(machineName)),
  );

  for (const catalogPkg of orderedPackages) {
    const pkg = packagesByMachineName.get(catalogPkg.machineName);
    if (!pkg) {
      continue;
    }

    await applyInstallStepsForPackage(catalogPkg, "instance", {
      instance,
      packageGuid: pkg.guid,
    });
  }
}

module.exports = {
  applyGlobalPackageInstalls,
  applyGlobalInstallForMachine,
  applyInstallForInstance,
};
