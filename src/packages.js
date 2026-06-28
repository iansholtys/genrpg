const fs = require("node:fs/promises");
const path = require("node:path");

const semver = require("semver");

const { PackageLoadError } = require("./errors/PackageLoadError");
const { trimmedString } = require("./lib/strings");
const { readOptionalYamlFile } = require("./lib/yamlFile");

const REPO_ROOT = path.join(__dirname, "..");
const STATIC_PKG_PREFIX = "/static/pkg";
let packageCache = null;

function parseRequirement(entry, sourceLabel) {
  if (typeof entry !== "string") {
    throw new PackageLoadError("Invalid package configuration", [
      `${sourceLabel}: each requirement must be a string`,
    ]);
  }

  const separator = entry.indexOf(":");
  if (separator <= 0 || separator === entry.length - 1) {
    throw new PackageLoadError("Invalid package configuration", [
      `${sourceLabel}: requirement "${entry}" must use machine:range format`,
    ]);
  }

  const machineName = entry.slice(0, separator).trim();
  const range = entry.slice(separator + 1).trim();

  if (!machineName || !range) {
    throw new PackageLoadError("Invalid package configuration", [
      `${sourceLabel}: requirement "${entry}" must use machine:range format`,
    ]);
  }

  if (!semver.validRange(range)) {
    throw new PackageLoadError("Invalid package configuration", [
      `${sourceLabel}: requirement "${entry}" has an invalid semver range`,
    ]);
  }

  return { machineName, range };
}

function normalizeAssetPath(entry, label, kind) {
  if (typeof entry !== "string" || !entry.trim()) {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: each assets.${kind} entry must be a non-empty string`,
    ]);
  }

  const normalized = entry.trim().replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalized) || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: assets.${kind} path "${entry}" must be relative to the package root`,
    ]);
  }

  return normalized;
}

function parseAssetList(rawList, label, kind) {
  if (rawList === undefined) {
    return [];
  }

  if (!Array.isArray(rawList)) {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: assets.${kind} must be an array`,
    ]);
  }

  return rawList.map((entry) => normalizeAssetPath(entry, label, kind));
}

function packageRootDir(packagePath) {
  return path.join(REPO_ROOT, packagePath.split("/").join(path.sep));
}

function assetPublicUrl(packagePath, relativePath) {
  const posixPath = path.posix.join(packagePath, relativePath.split(path.sep).join("/"));
  return `${STATIC_PKG_PREFIX}/${posixPath}`;
}

function assertPathInsidePackage(packageDir, absolutePath, relativePath, label, kind) {
  const relative = path.relative(packageDir, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: assets.${kind} path "${relativePath}" escapes the package directory`,
    ]);
  }
}

async function validateAndResolveAssets(pkg, assets, label) {
  const packageDir = packageRootDir(pkg.path);
  const css = [];
  const cssUrls = [];
  const js = [];
  const jsUrls = [];

  for (const relativePath of assets.css) {
    const absolutePath = path.resolve(packageDir, relativePath);
    assertPathInsidePackage(packageDir, absolutePath, relativePath, label, "css");

    try {
      await fs.access(absolutePath);
    } catch {
      throw new PackageLoadError("Invalid package configuration", [
        `${label}: assets.css file not found: ${relativePath}`,
      ]);
    }

    css.push(relativePath);
    cssUrls.push(assetPublicUrl(pkg.path, relativePath));
  }

  for (const relativePath of assets.js) {
    const absolutePath = path.resolve(packageDir, relativePath);
    assertPathInsidePackage(packageDir, absolutePath, relativePath, label, "js");

    try {
      await fs.access(absolutePath);
    } catch {
      throw new PackageLoadError("Invalid package configuration", [
        `${label}: assets.js file not found: ${relativePath}`,
      ]);
    }

    js.push(relativePath);
    jsUrls.push(assetPublicUrl(pkg.path, relativePath));
  }

  return { css, cssUrls, js, jsUrls };
}

function normalizeAssetsManifest(raw, label) {
  if (raw === undefined || raw === null) {
    return { css: [], js: [] };
  }

  if (!raw || typeof raw !== "object") {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: assets manifest must be a YAML object`,
    ]);
  }

  return {
    css: parseAssetList(raw.css, label, "css"),
    js: parseAssetList(raw.js, label, "js"),
  };
}

async function readPackageAssets(packageDir, machineName) {
  const assetsPath = path.join(packageDir, `${machineName}.assets.yml`);
  const label = `${machineName}.assets.yml`;
  const raw = await readOptionalYamlFile(assetsPath);
  if (!raw) {
    return { css: [], js: [] };
  }
  return normalizeAssetsManifest(raw, label);
}

function normalizeManifest(raw, { packagePath, directoryName, manifestFile }) {
  const details = [];
  const label = manifestFile;

  if (!raw || typeof raw !== "object") {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: manifest must be a YAML object`,
    ]);
  }

  const name = trimmedString(raw.name);
  const machineName = trimmedString(raw.machine_name);
  const version = trimmedString(raw.version);

  if (!name) details.push(`${label}: name is required`);
  if (!machineName) details.push(`${label}: machine_name is required`);
  if (!version) details.push(`${label}: version is required`);
  else if (!semver.valid(version)) details.push(`${label}: version must be valid semver`);

  const manifestStem = path.basename(manifestFile, ".package.yml");
  if (machineName && machineName !== manifestStem) {
    details.push(
      `${label}: machine_name "${machineName}" must match manifest filename "${manifestStem}"`,
    );
  }

  if (machineName && machineName !== directoryName) {
    details.push(
      `${label}: machine_name "${machineName}" must match directory "${directoryName}"`,
    );
  }

  if (details.length) {
    throw new PackageLoadError("Invalid package configuration", details);
  }

  const requirements = [];
  const rawRequirements = raw.requirements ?? [];

  if (!Array.isArray(rawRequirements)) {
    throw new PackageLoadError("Invalid package configuration", [
      `${label}: requirements must be an array`,
    ]);
  }

  for (const entry of rawRequirements) {
    requirements.push(parseRequirement(entry, label));
  }

  return {
    name,
    machineName,
    version,
    requirements,
    path: packagePath,
  };
}

async function discoverPackageManifest(packageDir, packagePath) {
  const directoryName = path.basename(packageDir);
  const manifestFile = `${directoryName}.package.yml`;
  const manifestPath = path.join(packageDir, manifestFile);
  const raw = await readOptionalYamlFile(manifestPath);
  if (!raw) {
    return null;
  }
  return normalizeManifest(raw, { packagePath, directoryName, manifestFile });
}

async function discoverPackages() {
  const packages = [];
  const details = [];

  const genrpgDir = path.join(REPO_ROOT, "genrpg");
  const genrpgManifest = await discoverPackageManifest(genrpgDir, "genrpg");
  if (genrpgManifest) {
    packages.push(genrpgManifest);
  } else {
    details.push("genrpg/genrpg.package.yml is missing");
  }

  const packagesDir = path.join(REPO_ROOT, "packages");
  let packageEntries = [];

  try {
    packageEntries = await fs.readdir(packagesDir, { withFileTypes: true });
  } catch {
    details.push("packages directory is missing");
  }

  for (const entry of packageEntries) {
    if (!entry.isDirectory() || entry.name === ".git") continue;

    const packageDir = path.join(packagesDir, entry.name);
    const packagePath = path.posix.join("packages", entry.name);
    const manifest = await discoverPackageManifest(packageDir, packagePath);

    if (manifest) {
      packages.push(manifest);
    }
  }

  if (details.length) {
    throw new PackageLoadError("Invalid package configuration", details);
  }

  const byMachineName = new Map(packages.map((pkg) => [pkg.machineName, pkg]));

  for (const pkg of packages) {
    for (const requirement of pkg.requirements) {
      const dependency = byMachineName.get(requirement.machineName);
      if (!dependency) {
        details.push(
          `${pkg.machineName}: requirement "${requirement.machineName}:${requirement.range}" references missing package "${requirement.machineName}"`,
        );
        continue;
      }

      if (!semver.satisfies(dependency.version, requirement.range)) {
        details.push(
          `${pkg.machineName}: requirement "${requirement.machineName}:${requirement.range}" is not satisfied by ${dependency.machineName}@${dependency.version}`,
        );
      }
    }
  }

  packages.sort((a, b) => a.machineName.localeCompare(b.machineName));
  return { packages, configurationIssues: details };
}

function assertValidPackageConfiguration(configurationIssues) {
  if (configurationIssues.length) {
    throw new PackageLoadError("Invalid package configuration", configurationIssues);
  }
}

async function enrichPackageWithAssets(pkg) {
  const packageDir = packageRootDir(pkg.path);
  const label = `${pkg.path}/${pkg.machineName}.assets.yml`;
  const assets = await readPackageAssets(packageDir, pkg.machineName);
  const resolved = await validateAndResolveAssets(pkg, assets, label);

  return {
    ...pkg,
    assets: {
      css: resolved.css,
      js: resolved.js,
    },
    assetUrls: {
      css: resolved.cssUrls,
      js: resolved.jsUrls,
    },
  };
}

async function enrichAllPackagesWithAssets(packages) {
  const enriched = [];
  for (const pkg of packages) {
    enriched.push(await enrichPackageWithAssets(pkg));
  }
  return enriched;
}

/**
 * Topological sort of all given packages by requirement edges (dependencies first).
 *
 * @param {object[]} packages
 * @returns {object[]}
 */
function sortPackagesByDependencies(packages) {
  const byMachineName = new Map(packages.map((pkg) => [pkg.machineName, pkg]));
  const sorted = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(machineName) {
    if (visited.has(machineName)) return;
    if (visiting.has(machineName)) {
      throw new PackageLoadError("Invalid package configuration", [
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

function sortPackagesTopologically(selectedMachineNames, packages) {
  const byMachineName = new Map(packages.map((pkg) => [pkg.machineName, pkg]));
  const selected = new Set(selectedMachineNames);
  const inDegree = new Map();
  const dependents = new Map();

  for (const machineName of selected) {
    inDegree.set(machineName, 0);
    dependents.set(machineName, []);
  }

  for (const machineName of selected) {
    const pkg = byMachineName.get(machineName);
    if (!pkg) continue;

    for (const requirement of pkg.requirements) {
      if (!selected.has(requirement.machineName)) continue;

      inDegree.set(machineName, (inDegree.get(machineName) || 0) + 1);
      dependents.get(requirement.machineName).push(machineName);
    }
  }

  const queue = [...selected].filter((machineName) => inDegree.get(machineName) === 0);
  queue.sort();
  const ordered = [];

  while (queue.length) {
    const machineName = queue.shift();
    ordered.push(byMachineName.get(machineName));

    for (const dependent of dependents.get(machineName) || []) {
      const nextDegree = inDegree.get(dependent) - 1;
      inDegree.set(dependent, nextDegree);
      if (nextDegree === 0) {
        queue.push(dependent);
        queue.sort();
      }
    }
  }

  if (ordered.length !== selected.size) {
    throw new PackageLoadError("Invalid package configuration", [
      "Selected packages contain a circular dependency",
    ]);
  }

  return ordered;
}

/**
 * Resolve API machine names to stored package install rows.
 * Unknown or uninstalled packages are rejected here; requirement closure is
 * validated by {@link validatePackageInstallSelection} via entity validate().
 *
 * @param {string[]} selectedMachineNames
 * @returns {Promise<{ valid: boolean, errors: string[], packages: object[] }>}
 */
async function packagesFromMachineNames(selectedMachineNames) {
  const catalog = await loadPackages({ strict: true });
  const PackageStorage = require("./storage/packageStorage");
  const installedPackages = await PackageStorage.global().list({ skipEvents: true });
  const errors = [];
  const byMachineName = new Map(catalog.map((pkg) => [pkg.machineName, pkg]));
  const selected = new Set();

  if (!Array.isArray(selectedMachineNames) || !selectedMachineNames.length) {
    return { valid: false, errors: ["At least one package must be selected"], packages: [] };
  }

  for (const machineName of selectedMachineNames) {
    if (typeof machineName !== "string" || !byMachineName.has(machineName)) {
      errors.push(`Unknown package "${machineName}"`);
      continue;
    }
    if (!installedPackages.some((pkg) => pkg.machineName === machineName)) {
      errors.push(`Package "${machineName}" is not installed`);
      continue;
    }
    selected.add(machineName);
  }

  const packages = [...selected]
    .sort()
    .map((machineName) => ({
      packageGuid: installedPackages.find((pkg) => pkg.machineName === machineName).guid,
      installVersion: 0,
    }));

  return {
    valid: errors.length === 0,
    errors,
    packages,
  };
}

/**
 * Validate stored package install rows, including requirement closure.
 *
 * @param {object[]} packages
 * @returns {Promise<string[]>}
 */
async function validatePackageInstallSelection(packages) {
  const catalog = await loadPackages({ strict: true });
  const PackageStorage = require("./storage/packageStorage");
  const installedPackages = await PackageStorage.global().list({ skipEvents: true });
  const errors = [];

  if (!Array.isArray(packages) || !packages.length) {
    return ["At least one package must be selected"];
  }

  const byMachineName = new Map(catalog.map((pkg) => [pkg.machineName, pkg]));
  const selected = new Set();

  for (const entry of packages) {
    if (!entry?.packageGuid) {
      errors.push("Each package entry requires a packageGuid");
      continue;
    }

    const installedPackage = installedPackages.find((pkg) => pkg.guid === entry.packageGuid);
    if (!installedPackage) {
      errors.push("Unknown package selection");
      continue;
    }

    if (!byMachineName.has(installedPackage.machineName)) {
      errors.push(`Unknown package "${installedPackage.machineName}"`);
      continue;
    }

    selected.add(installedPackage.machineName);
  }

  for (const machineName of selected) {
    const pkg = byMachineName.get(machineName);
    for (const requirement of pkg.requirements) {
      if (!selected.has(requirement.machineName)) {
        errors.push(
          `${machineName} requires ${requirement.machineName} to be selected`,
        );
      }
    }
  }

  return errors;
}

function resolveInstanceAssets(machineNames, packages) {
  const ordered = sortPackagesTopologically(machineNames, packages).filter(Boolean);
  const css = [];
  const js = [];
  const packageAssets = [];

  for (const pkg of ordered) {
    const pkgCss = pkg.assetUrls?.css ?? [];
    const pkgJs = pkg.assetUrls?.js ?? [];
    css.push(...pkgCss);
    js.push(...pkgJs);
    packageAssets.push({
      machineName: pkg.machineName,
      css: pkgCss,
      js: pkgJs,
    });
  }

  return {
    css,
    js,
    packageNames: ordered.map((pkg) => pkg.machineName),
    packages: packageAssets,
  };
}

async function resolveInstanceAssetsForRequest(machineNames, packages) {
  const selectedPackages = selectPackagesByName(packages, machineNames);
  const packagesWithAssets = await enrichAllPackagesWithAssets(selectedPackages);
  return resolveInstanceAssets(machineNames, packagesWithAssets);
}

function propertyToColumnName(property) {
  return property.replace(/([A-Z])/g, (_, char) => `_${char.toLowerCase()}`);
}

async function refreshPackageCache() {
  const discovered = await discoverPackages();
  packageCache = {
    ...discovered,
  };
  return packageCache;
}

function selectPackagesByName(packages, packageNames) {
  if (packageNames == null) {
    return packages;
  }

  const packageNameSet = new Set(packageNames);
  return packages.filter((pkg) => packageNameSet.has(pkg.machineName));
}

/**
 * Load package manifests discovered on disk (from {@link refreshPackageCache}).
 *
 * By default this is filesystem-only: name, machine name, semver, requirements,
 * asset paths, etc. It does not know which packages are registered in the database.
 *
 * Pass `withRegistry: true` to merge in {@link PackageStorage} rows for every
 * catalog entry: `guid` (null when not registered) and `installed` (true when a
 * `genrpg.packages` row exists). Used for admin/API views that show install state
 * alongside on-disk package metadata.
 *
 * @param {{ strict?: boolean, packageNames?: string[] | null, withRegistry?: boolean }} [options]
 * @returns {Promise<object[]>}
 */
async function loadPackages({ strict = false, packageNames = null, withRegistry = false } = {}) {
  if (!packageCache) {
    await refreshPackageCache();
  }

  if (strict) {
    assertValidPackageConfiguration(packageCache.configurationIssues);
  }

  let packages = selectPackagesByName(packageCache.packages, packageNames);

  if (withRegistry) {
    const PackageStorage = require("./storage/packageStorage");
    const registryByMachine = new Map(
      (await PackageStorage.global().list({ skipEvents: true }))
        .map((entry) => [entry.machineName, entry]),
    );
    packages = packages.map((pkg) => {
      const registry = registryByMachine.get(pkg.machineName);
      return {
        ...pkg,
        guid: registry?.guid ?? null,
        installed: registry != null,
      };
    });
  }

  return packages;
}

function getPackageConfigurationIssues() {
  return packageCache?.configurationIssues ?? [];
}

function invalidatePackageCache() {
  packageCache = null;
  try {
    const { invalidatePackageSubscribers } = require("./events/packageEvents");
    invalidatePackageSubscribers();
  } catch {
    // events module may not be loaded yet during early startup
  }
  try {
    const { clearMemory } = require("./services/cacheService");
    clearMemory();
  } catch {
    // cache service may not be loaded yet during early startup
  }
}

module.exports = {
  PackageLoadError,
  REPO_ROOT,
  packageRootDir,
  propertyToColumnName,
  loadPackages,
  getPackageConfigurationIssues,
  refreshPackageCache,
  invalidatePackageCache,
  resolveInstanceAssetsForRequest,
  packagesFromMachineNames,
  validatePackageInstallSelection,
  sortPackagesByDependencies,
};
