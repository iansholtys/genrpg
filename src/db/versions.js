const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const { pool: defaultPool } = require("./pool");

const ROOT_DIR = path.resolve(__dirname, "..", "..");

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listVersionFiles(directory) {
  if (!(await pathExists(directory))) return [];

  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function listSchemaVersionDirectories(directory) {
  if (!(await pathExists(directory))) return [];

  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((entry) => isSemver(entry))
    .sort(compareSemver)
    .map((entry) => path.join(directory, entry));
}

function isSemver(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function parseSemver(value) {
  const [versionWithoutBuild] = value.split("+");
  const [releaseVersion, prerelease = ""] = versionWithoutBuild.split("-");
  const [major, minor, patch] = releaseVersion.split(".").map(Number);

  return {
    major,
    minor,
    patch,
    prerelease: prerelease ? prerelease.split(".") : [],
  };
}

function compareSemver(left, right) {
  const leftVersion = parseSemver(left);
  const rightVersion = parseSemver(right);

  for (const key of ["major", "minor", "patch"]) {
    if (leftVersion[key] !== rightVersion[key]) {
      return leftVersion[key] - rightVersion[key];
    }
  }

  if (!leftVersion.prerelease.length && !rightVersion.prerelease.length) return 0;
  if (!leftVersion.prerelease.length) return 1;
  if (!rightVersion.prerelease.length) return -1;

  const maxLength = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];

    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;

    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart.localeCompare(rightPart);
  }

  return 0;
}

function parseVersionFile(packageName, schemaVersion, filePath) {
  const fileName = path.basename(filePath);
  const match = fileName.match(/^(\d{4,})_(.+)\.sql$/);

  if (!match) {
    throw new Error(
      `Invalid schema version filename "${fileName}". Use "<sequence>_<name>.sql", such as "0001_session_table.sql".`,
    );
  }

  return {
    packageName,
    schemaVersion,
    fileOrder: match[1],
    name: match[2],
    fileName,
    filePath,
  };
}

async function discoverSchemaVersions(rootDir = ROOT_DIR) {
  const schemaVersions = [];
  const genrpgDir = path.join(rootDir, "genrpg", "db");

  for (const versionDir of await listSchemaVersionDirectories(genrpgDir)) {
    const schemaVersion = path.basename(versionDir);
    for (const filePath of await listVersionFiles(versionDir)) {
      schemaVersions.push(parseVersionFile("genrpg", schemaVersion, filePath));
    }
  }

  const packagesDir = path.join(rootDir, "packages");
  if (await pathExists(packagesDir)) {
    const packageEntries = await fs.readdir(packagesDir, { withFileTypes: true });
    const packageNames = packageEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    for (const packageName of packageNames) {
      const packageDbDir = path.join(packagesDir, packageName, "db");
      for (const versionDir of await listSchemaVersionDirectories(packageDbDir)) {
        const schemaVersion = path.basename(versionDir);
        for (const filePath of await listVersionFiles(versionDir)) {
          schemaVersions.push(parseVersionFile(packageName, schemaVersion, filePath));
        }
      }
    }
  }

  assertNoDuplicateVersionFiles(schemaVersions);
  return schemaVersions;
}

function assertNoDuplicateVersionFiles(schemaVersions) {
  const seenFiles = new Set();
  const seenOrders = new Set();

  for (const schemaVersion of schemaVersions) {
    const versionKey = `${schemaVersion.packageName}:${schemaVersion.schemaVersion}`;
    const fileKey = `${versionKey}:${schemaVersion.fileName}`;
    const orderKey = `${versionKey}:${schemaVersion.fileOrder}`;

    if (seenFiles.has(fileKey)) {
      throw new Error(`Duplicate schema version file "${fileKey}".`);
    }
    if (seenOrders.has(orderKey)) {
      throw new Error(`Duplicate schema version file order "${orderKey}".`);
    }

    seenFiles.add(fileKey);
    seenOrders.add(orderKey);
  }
}

async function ensureSchemaVersionTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      package_name text NOT NULL,
      schema_version text NOT NULL,
      file_name text NOT NULL,
      file_order text NOT NULL,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (package_name, schema_version, file_name)
    );
  `);
}

async function getAppliedSchemaVersions(client) {
  const result = await client.query(`
    SELECT package_name, schema_version, file_name, checksum
    FROM schema_versions
  `);
  const applied = new Map();

  for (const row of result.rows) {
    applied.set(`${row.package_name}:${row.schema_version}:${row.file_name}`, row.checksum);
  }

  return applied;
}

async function readSchemaVersion(schemaVersion) {
  const sql = await fs.readFile(schemaVersion.filePath, "utf8");
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  return { sql, checksum };
}

async function applySchemaVersion(client, schemaVersion, sql, checksum) {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      `
        INSERT INTO schema_versions
          (package_name, schema_version, file_name, file_order, name, checksum)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        schemaVersion.packageName,
        schemaVersion.schemaVersion,
        schemaVersion.fileName,
        schemaVersion.fileOrder,
        schemaVersion.name,
        checksum,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function applySchemaVersions({ pool = defaultPool, rootDir = ROOT_DIR } = {}) {
  const client = await pool.connect();

  try {
    await ensureSchemaVersionTable(client);
    const applied = await getAppliedSchemaVersions(client);
    const schemaVersions = await discoverSchemaVersions(rootDir);
    const appliedNow = [];

    for (const schemaVersion of schemaVersions) {
      const key = `${schemaVersion.packageName}:${schemaVersion.schemaVersion}:${schemaVersion.fileName}`;
      const { sql, checksum } = await readSchemaVersion(schemaVersion);
      const appliedChecksum = applied.get(key);

      if (appliedChecksum) {
        if (appliedChecksum !== checksum) {
          throw new Error(
            `Applied schema version "${key}" checksum does not match ${schemaVersion.fileName}.`,
          );
        }
        continue;
      }

      await applySchemaVersion(client, schemaVersion, sql, checksum);
      appliedNow.push(key);
    }

    return { applied: appliedNow };
  } finally {
    client.release();
  }
}

if (require.main === module) {
  applySchemaVersions()
    .then(({ applied }) => {
      if (applied.length) {
        console.log(`Applied schema versions: ${applied.join(", ")}`);
      } else {
        console.log("No schema versions to apply.");
      }
    })
    .finally(() => defaultPool.end())
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { applySchemaVersions, discoverSchemaVersions };
