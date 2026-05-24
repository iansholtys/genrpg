const express = require("express");

const { isGlobalAdmin } = require("../auth");
const { pool } = require("../db/pool");
const { parsePackageCsv } = require("../packages");

const charactersRouter = express.Router();
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

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

async function loadCharacterSchemas(packageNames) {
  const schemas = [...new Set(["genrpg", ...packageNames])];
  const invalidSchema = schemas.find((schema) => !IDENTIFIER_PATTERN.test(schema));
  if (invalidSchema) {
    throw new Error(`Invalid package schema name: ${invalidSchema}`);
  }

  const result = await pool.query(
    `
      SELECT table_schema
      FROM information_schema.tables
      WHERE table_schema = ANY($1::text[])
        AND table_name = 'characters'
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema ASC
    `,
    [schemas],
  );

  return result.rows.map((row) => row.table_schema);
}

function buildCharactersQuery(schemas) {
  if (!schemas.includes("genrpg")) {
    throw new Error("Core characters table does not exist");
  }

  const packageSchemas = schemas.filter((schema) => schema !== "genrpg");
  const joins = packageSchemas.map((schema, index) => {
    const alias = `c${index + 1}`;
    return `LEFT JOIN ${quoteIdentifier(schema)}.characters ${alias} ON ${alias}.guid = c0.guid`;
  });
  const packageColumns = packageSchemas.map((schema, index) => {
    const alias = `c${index + 1}`;
    return `'${schema}', CASE WHEN ${alias}.guid IS NULL THEN NULL ELSE row_to_json(${alias}) END`;
  });
  const jsonArgs = [
    `'genrpg', row_to_json(c0)`,
    ...packageColumns,
  ].join(",\n            ");

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
    ORDER BY c0.display_name ASC NULLS LAST, c0.create_datetime ASC
  `;
}

charactersRouter.get("/instances/:instanceGuid/characters", async (req, res, next) => {
  try {
    const { instanceGuid } = req.params;
    const instance = await requireInstancePermission(req, res, instanceGuid, "instance.run");
    if (!instance) {
      return;
    }

    const schemas = await loadCharacterSchemas(parsePackageCsv(instance.packages));
    const result = await pool.query(buildCharactersQuery(schemas), [instanceGuid]);

    res.json({
      characters: result.rows.map((row) => ({
        guid: row.guid,
        instance_guid: row.instance_guid,
        packages: row.packages,
      })),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = charactersRouter;
