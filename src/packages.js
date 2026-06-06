const fs = require("node:fs/promises");
const path = require("node:path");

const semver = require("semver");
const yaml = require("yaml");

const REPO_ROOT = path.join(__dirname, "..");
const STATIC_PKG_PREFIX = "/static/pkg";
const CORE_PACKAGE_MACHINE_NAME = "genrpg";

let packageCache = null;
let packagesWithAssetsCache = null;

class PackageLoadError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "PackageLoadError";
    this.details = details;
    this.status = 500;
  }
}

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

  try {
    await fs.access(assetsPath);
  } catch {
    return { css: [], js: [] };
  }

  const contents = await fs.readFile(assetsPath, "utf8");
  const raw = yaml.parse(contents);
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

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const machineName =
    typeof raw.machine_name === "string" ? raw.machine_name.trim() : "";
  const version = typeof raw.version === "string" ? raw.version.trim() : "";

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

async function readManifest(manifestPath, meta) {
  const contents = await fs.readFile(manifestPath, "utf8");
  const raw = yaml.parse(contents);
  return normalizeManifest(raw, {
    ...meta,
    manifestFile: path.basename(manifestPath),
  });
}

async function discoverPackageManifest(packageDir, packagePath) {
  const directoryName = path.basename(packageDir);
  const manifestPath = path.join(packageDir, `${directoryName}.package.yml`);

  try {
    await fs.access(manifestPath);
  } catch {
    return null;
  }

  return readManifest(manifestPath, { packagePath, directoryName });
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

/** Instance asset loads always include core GenRPG plus declared package requirements. */
function expandPackageSelectionForAssets(selectedMachineNames, packages) {
  const byMachineName = new Map(packages.map((pkg) => [pkg.machineName, pkg]));
  const expanded = new Set(selectedMachineNames);

  expanded.add(CORE_PACKAGE_MACHINE_NAME);

  let changed = true;
  while (changed) {
    changed = false;
    for (const machineName of expanded) {
      const pkg = byMachineName.get(machineName);
      if (!pkg) {
        continue;
      }

      for (const requirement of pkg.requirements) {
        if (!expanded.has(requirement.machineName)) {
          expanded.add(requirement.machineName);
          changed = true;
        }
      }
    }
  }

  return [...expanded];
}

function resolveInstanceAssets(selectedMachineNames, packages) {
  const expandedSelection = expandPackageSelectionForAssets(selectedMachineNames, packages);
  const ordered = sortPackagesTopologically(expandedSelection, packages).filter(Boolean);
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

async function resolveInstanceAssetsForRequest(selectedMachineNames, packages) {
  const expandedSelection = expandPackageSelectionForAssets(selectedMachineNames, packages);
  const selectedPackages = packages.filter((pkg) => expandedSelection.includes(pkg.machineName));
  const packagesWithAssets = await enrichAllPackagesWithAssets(selectedPackages);
  return resolveInstanceAssets(selectedMachineNames, packagesWithAssets);
}

async function refreshPackageCache() {
  packageCache = await discoverPackages();
  packagesWithAssetsCache = null;
  const { refreshEntityExtensionIndex } = require("./lib/entityExtensionIndex");
  await refreshEntityExtensionIndex(packageCache.packages);
  return packageCache;
}

async function loadPackages({ strict = false } = {}) {
  if (!packageCache) {
    await refreshPackageCache();
  }

  if (strict) {
    assertValidPackageConfiguration(packageCache.configurationIssues);
  }

  return packageCache;
}

// Loads optional *.assets.yml manifests; used for Enter Instance, not routine package listing.
async function loadPackagesWithAssets() {
  if (!packagesWithAssetsCache) {
    const { packages } = await loadPackages({ strict: true });
    packagesWithAssetsCache = {
      packages: await enrichAllPackagesWithAssets(packages),
    };
  }

  return packagesWithAssetsCache;
}

function invalidatePackageCache() {
  packageCache = null;
  packagesWithAssetsCache = null;
  try {
    const { invalidateEntityExtensionIndex } = require("./lib/entityExtensionIndex");
    invalidateEntityExtensionIndex();
  } catch {
    // entity extension index may not be loaded yet during early startup
  }
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

function parsePackageCsv(value) {
  if (!value) return [];
  return [...new Set(String(value).split(",").map((entry) => entry.trim()).filter(Boolean))].sort();
}

/**
 * Expanded instance packages as { [machineName]: humanLabel } for request context.
 */
function resolveInstancePackages(packageCsv, packages) {
  const expanded = expandPackageSelectionForAssets(parsePackageCsv(packageCsv), packages);
  const expandedSet = new Set(expanded);
  return Object.fromEntries(
    packages
      .filter((pkg) => expandedSet.has(pkg.machineName))
      .map((pkg) => [pkg.machineName, pkg.name]),
  );
}

function validatePackageSelection(selectedMachineNames, packages) {
  const details = [];
  const byMachineName = new Map(packages.map((pkg) => [pkg.machineName, pkg]));
  const selected = new Set();

  if (!Array.isArray(selectedMachineNames) || !selectedMachineNames.length) {
    return { valid: false, details: ["At least one package must be selected"], packageCsv: "" };
  }

  for (const machineName of selectedMachineNames) {
    if (typeof machineName !== "string" || !byMachineName.has(machineName)) {
      details.push(`Unknown package "${machineName}"`);
      continue;
    }
    selected.add(machineName);
  }

  for (const machineName of selected) {
    const pkg = byMachineName.get(machineName);
    for (const requirement of pkg.requirements) {
      if (!selected.has(requirement.machineName)) {
        details.push(
          `${machineName} requires ${requirement.machineName} to be selected`,
        );
      }
    }
  }

  return {
    valid: details.length === 0,
    details,
    packageCsv: [...selected].sort().join(","),
  };
}

module.exports = {
  PackageLoadError,
  REPO_ROOT,
  packageRootDir,
  loadPackages,
  refreshPackageCache,
  invalidatePackageCache,
  parsePackageCsv,
  resolveInstancePackages,
  validatePackageSelection,
  resolveInstanceAssetsForRequest,
  expandPackageSelectionForAssets,
};
