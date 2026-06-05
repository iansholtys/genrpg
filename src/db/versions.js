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

// Removed semver logic

function parseVersionFile(packageName, filePath) {
  const fileName = path.basename(filePath);
  const match = fileName.match(/^(\d{4,})_(.+)\.sql$/);

  if (!match) {
    throw new Error(
      `Invalid schema filename "${fileName}". Use "<sequence>_<name>.sql", such as "0001_session_table.sql".`,
    );
  }

  return {
    packageName,
    fileOrder: match[1],
    name: match[2],
    fileName,
    filePath,
  };
}

async function discoverSchemaVersions(rootDir = ROOT_DIR) {
  const schemaVersions = [];
  const genrpgDir = path.join(rootDir, "genrpg", "db");

  for (const filePath of await listVersionFiles(genrpgDir)) {
    schemaVersions.push(parseVersionFile("genrpg", filePath));
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
      for (const filePath of await listVersionFiles(packageDbDir)) {
        schemaVersions.push(parseVersionFile(packageName, filePath));
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
    const versionKey = `${schemaVersion.packageName}`;
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
      file_name text NOT NULL,
      file_order text NOT NULL,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (package_name, file_name)
    );
  `);
}

async function getAppliedSchemaVersions(client) {
  const result = await client.query(`
    SELECT package_name, file_name, checksum
    FROM schema_versions
  `);
  const applied = new Map();

  for (const row of result.rows) {
    applied.set(`${row.package_name}:${row.file_name}`, row.checksum);
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
          (package_name, file_name, file_order, name, checksum)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        schemaVersion.packageName,
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

async function reapplyPackageSchemaVersions({
  pool = defaultPool,
  packageName,
  rootDir = ROOT_DIR,
} = {}) {
  if (!packageName) {
    throw new Error("packageName is required");
  }

  const client = await pool.connect();
  const appliedNow = [];

  try {
    await ensureSchemaVersionTable(client);
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${packageName}"`);

    const packageDbDir = path.join(rootDir, "packages", packageName, "db");
    const filePaths = await listVersionFiles(packageDbDir);

    for (const filePath of filePaths) {
      const schemaVersion = parseVersionFile(packageName, filePath);
      const { sql, checksum } = await readSchemaVersion(schemaVersion);
      const key = `${schemaVersion.packageName}:${schemaVersion.fileName}`;

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `
            INSERT INTO schema_versions
              (package_name, file_name, file_order, name, checksum)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (package_name, file_name)
            DO UPDATE SET
              file_order = EXCLUDED.file_order,
              name = EXCLUDED.name,
              checksum = EXCLUDED.checksum,
              applied_at = now()
          `,
          [
            schemaVersion.packageName,
            schemaVersion.fileName,
            schemaVersion.fileOrder,
            schemaVersion.name,
            checksum,
          ],
        );
        await client.query("COMMIT");
        appliedNow.push(key);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    return { applied: appliedNow };
  } finally {
    client.release();
  }
}

async function applyPendingSchemaVersionsForPackage({
  pool = defaultPool,
  packageName,
  rootDir = ROOT_DIR,
} = {}) {
  if (!packageName) {
    throw new Error("packageName is required");
  }

  const client = await pool.connect();
  const appliedNow = [];

  try {
    await ensureSchemaVersionTable(client);
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${packageName}"`);

    const applied = await getAppliedSchemaVersions(client);
    const schemaVersions = (await discoverSchemaVersions(rootDir)).filter(
      (entry) => entry.packageName === packageName,
    );

    for (const schemaVersion of schemaVersions) {
      const key = `${schemaVersion.packageName}:${schemaVersion.fileName}`;
      const { sql, checksum } = await readSchemaVersion(schemaVersion);
      const appliedChecksum = applied.get(key);

      if (appliedChecksum) {
        if (appliedChecksum !== checksum) {
          console.warn(
            `Schema version "${key}" was already applied but ${schemaVersion.fileName} has changed; skipping re-apply.`,
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

async function applySchemaVersions({ pool = defaultPool, rootDir = ROOT_DIR } = {}) {
  const client = await pool.connect();

  try {
    await ensureSchemaVersionTable(client);

    const { loadPackages } = require("../packages");
    const { packages } = await loadPackages({ strict: false });
    for (const pkg of packages) {
      if (pkg.machineName) {
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${pkg.machineName}"`);
      }
    }

    const applied = await getAppliedSchemaVersions(client);
    const schemaVersions = await discoverSchemaVersions(rootDir);
    const appliedNow = [];
    const freshlyInstalledPackages = new Set();
    const previouslyAppliedPackages = new Set([...applied.keys()].map((k) => k.split(":")[0]));

    for (const schemaVersion of schemaVersions) {
      const key = `${schemaVersion.packageName}:${schemaVersion.fileName}`;
      const { sql, checksum } = await readSchemaVersion(schemaVersion);
      const appliedChecksum = applied.get(key);

      if (appliedChecksum) {
        if (appliedChecksum !== checksum) {
          console.warn(
            `Schema version "${key}" was already applied but ${schemaVersion.fileName} has changed; skipping re-apply.`,
          );
        }
        continue;
      }

      await applySchemaVersion(client, schemaVersion, sql, checksum);
      appliedNow.push(key);

      if (!previouslyAppliedPackages.has(schemaVersion.packageName)) {
        freshlyInstalledPackages.add(schemaVersion.packageName);
      }
    }

    if (freshlyInstalledPackages.size > 0) {
      const { loadUpdatesModule, getLatestVersion } = require("../updates");
      for (const packageName of freshlyInstalledPackages) {
        const pkg = packages.find((p) => p.machineName === packageName);
        if (pkg) {
          try {
            const updatesModule = await loadUpdatesModule(pkg.machineName, pkg.path);
            const latestVersion = getLatestVersion(updatesModule);
            await client.query(
              `
              INSERT INTO genrpg.packages (package, version)
              VALUES ($1, $2)
              ON CONFLICT (package) DO UPDATE SET version = EXCLUDED.version
            `,
              [packageName, latestVersion],
            );
          } catch (error) {
            console.error(
              `Failed to initialize version for freshly installed package ${packageName}:`,
              error,
            );
          }
        }
      }
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

module.exports = {
  applySchemaVersions,
  applyPendingSchemaVersionsForPackage,
  reapplyPackageSchemaVersions,
};
