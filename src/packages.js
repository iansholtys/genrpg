const fs = require("node:fs/promises");
const path = require("node:path");

const semver = require("semver");
const yaml = require("yaml");

const REPO_ROOT = path.join(__dirname, "..");

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

  if (details.length) {
    throw new PackageLoadError("Invalid package configuration", details);
  }

  packages.sort((a, b) => a.machineName.localeCompare(b.machineName));
  return { packages };
}

async function loadPackages() {
  return discoverPackages();
}

function parsePackageCsv(value) {
  if (!value) return [];
  return [...new Set(String(value).split(",").map((entry) => entry.trim()).filter(Boolean))].sort();
}

function formatPackageCsv(machineNames) {
  return [...new Set(machineNames)].sort().join(",");
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
    packageCsv: formatPackageCsv([...selected]),
  };
}

module.exports = {
  PackageLoadError,
  loadPackages,
  parsePackageCsv,
  formatPackageCsv,
  validatePackageSelection,
};
