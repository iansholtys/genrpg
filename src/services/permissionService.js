/**
 * Central access control for API requests.
 */
const { pool } = require("../db/pool");
const { isGlobalAdmin } = require("../auth");
const {
  expandPackageSelectionForAssets,
  loadPackages,
  parsePackageCsv,
} = require("../packages");
const DEFAULT_INSTANCE_FIELDS = ["i.guid"];

function buildInstanceSelect(fields) {
  const selectFields = fields.map((field) => {
    if (field.startsWith("i.")) {
      return field;
    }
    return `i.${field}`;
  });
  return selectFields.join(",\n        ");
}

async function loadAccessibleInstance(instanceGuid, user, { fields } = {}) {
  const isAdmin = await isGlobalAdmin(user.guid);
  const selectClause = buildInstanceSelect(fields ?? DEFAULT_INSTANCE_FIELDS);
  const result = await pool.query(
    `
      SELECT
        ${selectClause}
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

async function getInstancePermissions(instanceGuid, userGuid) {
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

async function getUserInstanceRole(instanceGuid, userGuid) {
  const result = await pool.query(
    `
      SELECT r.name AS role_name
      FROM genrpg.instance_user_roles iur
      JOIN genrpg.roles r ON r.id = iur.role_id
      WHERE iur.instance_guid = $1 AND iur.user_guid = $2
    `,
    [instanceGuid, userGuid],
  );
  return result.rows[0]?.role_name || null;
}

async function userHasPermission(userGuid, instanceGuid, permissionName) {
  if (await isGlobalAdmin(userGuid)) {
    return true;
  }
  const permissions = await getInstancePermissions(instanceGuid, userGuid);
  return permissions.has(permissionName);
}

async function buildContext(user, instanceGuid, { fields } = {}) {
  const isGlobalAdminUser = await isGlobalAdmin(user.guid);
  const instance = await loadAccessibleInstance(instanceGuid, user, { fields });
  if (!instance) {
    return null;
  }

  if (instance.packages !== undefined) {
    const { packages } = await loadPackages({ strict: true });
    instance.packageNames = expandPackageSelectionForAssets(
      parsePackageCsv(instance.packages),
      packages,
    );
  }

  const permissions = isGlobalAdminUser
    ? null
    : await getInstancePermissions(instance.guid, user.guid);

  return {
    user,
    instance,
    permissions,
    isGlobalAdmin: isGlobalAdminUser,
    pool,
  };
}

function hasPermission(context, permissionName) {
  if (context.isGlobalAdmin) {
    return true;
  }
  return context.permissions?.has(permissionName) ?? false;
}

module.exports = {
  loadAccessibleInstance,
  getUserInstanceRole,
  userHasPermission,
  buildContext,
  hasPermission,
};
