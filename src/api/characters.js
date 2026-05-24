const crypto = require("node:crypto");
const express = require("express");

const { isGlobalAdmin } = require("../auth");
const { pool } = require("../db/pool");
const { loadPackages, parsePackageCsv } = require("../packages");

const charactersRouter = express.Router();
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;
const MANAGED_COLUMNS = new Set([
  "guid",
  "character_guid",
  "instance_guid",
  "user_guid",
  "create_datetime",
  "update_datetime",
]);
const LABEL_COLUMNS = ["name", "display_name", "full_name", "guid"];

async function loadAccessibleInstance(instanceGuid, user) {
  const isAdmin = await isGlobalAdmin(user.guid);
  const result = await pool.query(
    `
      SELECT i.guid, i.packages
      FROM genrpg.instances i
      LEFT JOIN genrpg.instance_user_roles iur
        ON iur.instance_guid = i.guid
        AND iur.user_guid = $1
      WHERE i.guid = $2
        AND ($3::boolean OR iur.user_guid IS NOT NULL)
    `,
    [user.guid, instanceGuid, isAdmin],
  );

  return result.rows[0] || null;
}

async function getUserInstancePermissions(instanceGuid, userGuid) {
  const result = await pool.query(
    `
      SELECT DISTINCT p.name
      FROM genrpg.instance_user_roles iur
      JOIN genrpg.role_permissions rp ON rp.role_id = iur.role_id
      JOIN genrpg.permissions p ON p.id = rp.permission_id
      WHERE iur.instance_guid = $1 AND iur.user_guid = $2
    `,
    [instanceGuid, userGuid],
  );
  return new Set(result.rows.map((row) => row.name));
}

async function requireInstancePermission(req, res, instanceGuid, permissionName) {
  const user = req.session.user;
  const instance = await loadAccessibleInstance(instanceGuid, user);
  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return null;
  }

  if (await isGlobalAdmin(user.guid)) {
    return instance;
  }

  const permissions = await getUserInstancePermissions(instanceGuid, user.guid);
  if (!permissions.has(permissionName)) {
    res.status(403).json({ error: "You do not have permission to perform this action" });
    return null;
  }

  return instance;
}

function quoteIdentifier(identifier) {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid database identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function quoteColumn(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid database column: ${identifier}`);
  }

  return `"${identifier}"`;
}

function isNonEmptyValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function inferInputType(column) {
  if (column.foreignKey) return "select";
  if (column.dataType === "boolean") return "checkbox";
  if (["integer", "bigint", "smallint", "numeric", "real", "double precision"].includes(column.dataType)) {
    return "number";
  }
  if (column.dataType === "date") return "date";
  if (column.dataType.includes("timestamp")) return "datetime-local";
  if (column.dataType === "text") return "textarea";
  return "text";
}

async function loadPackageLabels() {
  const { packages } = await loadPackages({ strict: false });
  return new Map(packages.map((pkg) => [pkg.machineName, pkg.name]));
}

async function loadCharacterSchemas(packageNames) {
  const schemas = [...new Set(["genrpg", ...packageNames])];
  const invalidSchema = schemas.find((schema) => !IDENTIFIER_PATTERN.test(schema));
  if (invalidSchema) {
    throw new Error(`Invalid package schema name: ${invalidSchema}`);
  }

  const result = await pool.query(
    `
      SELECT t.table_schema,
        EXISTS (
          SELECT 1
          FROM information_schema.columns c
          WHERE c.table_schema = t.table_schema
            AND c.table_name = t.table_name
            AND c.column_name = 'character_guid'
        ) AS has_character_guid
      FROM information_schema.tables t
      WHERE t.table_schema = ANY($1::text[])
        AND t.table_name = 'characters'
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_schema ASC
    `,
    [schemas],
  );

  const found = result.rows.map((row) => ({
    schema: row.table_schema,
    hasCharacterGuid: row.has_character_guid,
  }));
  if (!found.some((row) => row.schema === "genrpg")) {
    throw new Error("Core characters table does not exist");
  }

  return found.filter((row) => row.schema === "genrpg" || row.hasCharacterGuid);
}

async function loadCharacterColumns(schemas) {
  const result = await pool.query(
    `
      SELECT
        table_schema,
        column_name,
        ordinal_position,
        column_default,
        is_nullable,
        data_type,
        udt_name
      FROM information_schema.columns
      WHERE table_schema = ANY($1::text[])
        AND table_name = 'characters'
      ORDER BY table_schema ASC, ordinal_position ASC
    `,
    [schemas],
  );

  const columnsBySchema = new Map();
  for (const row of result.rows) {
    if (!columnsBySchema.has(row.table_schema)) columnsBySchema.set(row.table_schema, []);
    columnsBySchema.get(row.table_schema).push({
      name: row.column_name,
      ordinalPosition: row.ordinal_position,
      hasDefault: row.column_default !== null,
      nullable: row.is_nullable === "YES",
      required: row.is_nullable === "NO" && row.column_default === null,
      dataType: row.data_type === "USER-DEFINED" ? row.udt_name : row.data_type,
      default: row.column_default,
    });
  }

  return columnsBySchema;
}

async function loadCharacterForeignKeys(schemas) {
  const result = await pool.query(
    `
      SELECT
        kcu.table_schema,
        kcu.column_name,
        ccu.table_schema AS referenced_schema,
        ccu.table_name AS referenced_table,
        ccu.column_name AS referenced_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_schema = tc.constraint_schema
        AND kcu.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_schema = tc.constraint_schema
        AND ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND kcu.table_schema = ANY($1::text[])
        AND kcu.table_name = 'characters'
    `,
    [schemas],
  );

  const foreignKeys = new Map();
  for (const row of result.rows) {
    foreignKeys.set(`${row.table_schema}.${row.column_name}`, {
      schema: row.referenced_schema,
      table: row.referenced_table,
      column: row.referenced_column,
    });
  }

  return foreignKeys;
}

async function loadLabelColumn(referencedSchema, referencedTable) {
  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
    `,
    [referencedSchema, referencedTable],
  );
  const available = new Set(result.rows.map((row) => row.column_name));
  return LABEL_COLUMNS.find((column) => available.has(column)) || null;
}

async function loadForeignKeyOptions(foreignKey) {
  if (
    !IDENTIFIER_PATTERN.test(foreignKey.schema) ||
    !IDENTIFIER_PATTERN.test(foreignKey.table) ||
    !/^[a-z_][a-z0-9_]*$/.test(foreignKey.column)
  ) {
    return [];
  }

  const labelColumn = await loadLabelColumn(foreignKey.schema, foreignKey.table);
  if (!labelColumn) return [];

  const result = await pool.query(
    `
      SELECT ${quoteColumn(foreignKey.column)}::text AS value,
        ${quoteColumn(labelColumn)}::text AS label
      FROM ${quoteIdentifier(foreignKey.schema)}.${quoteIdentifier(foreignKey.table)}
      ORDER BY ${quoteColumn(labelColumn)} ASC NULLS LAST
      LIMIT 500
    `,
  );

  return result.rows.map((row) => ({ value: row.value, label: row.label || row.value }));
}

async function buildCharacterFormMetadata(packageNames) {
  const schemaRows = await loadCharacterSchemas(packageNames);
  const schemas = schemaRows.map((row) => row.schema);
  const [labels, columnsBySchema, foreignKeys] = await Promise.all([
    loadPackageLabels(),
    loadCharacterColumns(schemas),
    loadCharacterForeignKeys(schemas),
  ]);

  const formSchemas = [];
  for (const schema of schemas) {
    const columns = columnsBySchema.get(schema) || [];
    const formColumns = [];

    for (const column of columns) {
      if (MANAGED_COLUMNS.has(column.name)) continue;

      const foreignKey = foreignKeys.get(`${schema}.${column.name}`) || null;
      const normalizedColumn = {
        ...column,
        label: column.name.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
        required: column.required,
        foreignKey,
      };
      normalizedColumn.inputType = inferInputType(normalizedColumn);
      if (foreignKey) {
        normalizedColumn.options = await loadForeignKeyOptions(foreignKey);
      }
      formColumns.push(normalizedColumn);
    }

    formSchemas.push({
      schema,
      label: labels.get(schema) || (schema === "genrpg" ? "GenRPG" : schema),
      table: "characters",
      columns: formColumns,
    });
  }

  return { schemas: formSchemas };
}

function buildCharactersQuery(schemas, { byCharacterGuid = false } = {}) {
  const packageSchemas = schemas.filter((schema) => schema !== "genrpg");
  const joins = packageSchemas.map((schema, index) => {
    const alias = `c${index + 1}`;
    return `LEFT JOIN ${quoteIdentifier(schema)}.characters ${alias} ON ${alias}.character_guid = c0.guid`;
  });
  const packageColumns = packageSchemas.map((schema, index) => {
    const alias = `c${index + 1}`;
    return `'${schema}', CASE WHEN ${alias}.character_guid IS NULL THEN NULL ELSE row_to_json(${alias}) END`;
  });
  const jsonArgs = [
    `'genrpg', row_to_json(c0)`,
    ...packageColumns,
  ].join(",\n            ");
  const characterFilter = byCharacterGuid ? "AND c0.guid = $2" : "";

  return `
    SELECT
      c0.guid,
      c0.instance_guid,
      json_build_object(
            ${jsonArgs}
      ) AS packages
    FROM genrpg.characters c0
    ${joins.join("\n    ")}
    WHERE c0.instance_guid = $1
      ${characterFilter}
    ORDER BY c0.display_name ASC NULLS LAST, c0.create_datetime ASC
  `;
}

async function loadCharacterRows(instanceGuid, packageNames, characterGuid = null) {
  const schemaRows = await loadCharacterSchemas(packageNames);
  const schemas = schemaRows.map((row) => row.schema);
  const params = characterGuid ? [instanceGuid, characterGuid] : [instanceGuid];
  const result = await pool.query(
    buildCharactersQuery(schemas, { byCharacterGuid: Boolean(characterGuid) }),
    params,
  );

  return result.rows.map((row) => ({
    guid: row.guid,
    instance_guid: row.instance_guid,
    packages: row.packages,
  }));
}

function getWritableColumns(columnsBySchema, schema) {
  return (columnsBySchema.get(schema) || []).filter((column) => !MANAGED_COLUMNS.has(column.name));
}

function collectSubmittedValues(payload, writableColumns) {
  const values = {};
  const allowed = new Set(writableColumns.map((column) => column.name));
  for (const [name, value] of Object.entries(payload || {})) {
    if (allowed.has(name) && isNonEmptyValue(value)) {
      values[name] = value;
    }
  }
  return values;
}

function buildInsertQuery(schema, table, values) {
  const columns = Object.keys(values);
  if (!columns.length) {
    throw new Error(`No values supplied for ${schema}.${table}`);
  }

  const columnSql = columns.map(quoteColumn).join(", ");
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  return {
    sql: `INSERT INTO ${quoteIdentifier(schema)}.${quoteIdentifier(table)} (${columnSql}) VALUES (${placeholders})`,
    params: columns.map((column) => values[column]),
  };
}

async function createCharacter(instanceGuid, userGuid, instancePackages, payload) {
  const characterGuid = crypto.randomUUID();
  const schemaRows = await loadCharacterSchemas(instancePackages);
  const schemas = schemaRows.map((row) => row.schema);
  const columnsBySchema = await loadCharacterColumns(schemas);
  const packagesPayload = payload?.packages && typeof payload.packages === "object"
    ? payload.packages
    : {};
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const coreValues = {
      guid: characterGuid,
      instance_guid: instanceGuid,
      user_guid: userGuid,
      ...collectSubmittedValues(packagesPayload.genrpg, getWritableColumns(columnsBySchema, "genrpg")),
    };
    const coreInsert = buildInsertQuery("genrpg", "characters", coreValues);
    await client.query(coreInsert.sql, coreInsert.params);

    for (const schema of schemas.filter((entry) => entry !== "genrpg")) {
      const packageValues = collectSubmittedValues(
        packagesPayload[schema],
        getWritableColumns(columnsBySchema, schema),
      );
      if (!Object.keys(packageValues).length) continue;

      const columns = columnsBySchema.get(schema) || [];
      const guidColumn = columns.find((column) => column.name === "guid");
      const insertValues = { character_guid: characterGuid, ...packageValues };
      if (guidColumn?.required && !guidColumn.hasDefault) {
        insertValues.guid = crypto.randomUUID();
      }

      const packageInsert = buildInsertQuery(schema, "characters", insertValues);
      await client.query(packageInsert.sql, packageInsert.params);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return characterGuid;
}

charactersRouter.get("/instances/:instanceGuid/characters/form", async (req, res, next) => {
  try {
    const { instanceGuid } = req.params;
    const instance = await requireInstancePermission(req, res, instanceGuid, "instance.run");
    if (!instance) return;

    const metadata = await buildCharacterFormMetadata(parsePackageCsv(instance.packages));
    res.json(metadata);
  } catch (error) {
    next(error);
  }
});

charactersRouter.get("/instances/:instanceGuid/characters", async (req, res, next) => {
  try {
    const { instanceGuid } = req.params;
    const instance = await requireInstancePermission(req, res, instanceGuid, "instance.run");
    if (!instance) return;

    const characters = await loadCharacterRows(instanceGuid, parsePackageCsv(instance.packages));
    res.json({ characters });
  } catch (error) {
    next(error);
  }
});

charactersRouter.post("/instances/:instanceGuid/characters", async (req, res, next) => {
  try {
    const { instanceGuid } = req.params;
    const instance = await requireInstancePermission(req, res, instanceGuid, "instance.edit");
    if (!instance) return;

    const packageNames = parsePackageCsv(instance.packages);
    const characterGuid = await createCharacter(
      instanceGuid,
      req.session.user.guid,
      packageNames,
      req.body,
    );
    const characters = await loadCharacterRows(instanceGuid, packageNames, characterGuid);
    res.status(201).json({ character: characters[0] });
  } catch (error) {
    next(error);
  }
});

module.exports = charactersRouter;
