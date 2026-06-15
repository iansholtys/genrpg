/**
 * Central access control for API requests.
 */
const { pool } = require("../db/pool");
const { isGlobalAdmin } = require("../auth");
const { qualify, selectQuery } = require("./queryService");
const {
  loadPackages,
  resolveInstancePackages,
} = require("../packages");

async function loadAccessibleInstance(instanceGuid, user, { fields } = {}) {
  const isAdmin = await isGlobalAdmin(user.guid);
  const instanceAlias = "i";
  const query = selectQuery()
    .from("genrpg", "instances", instanceAlias)
    .addFields(instanceAlias, fields ?? ["guid"])
    .whereColumn(instanceAlias, "guid", instanceGuid);

  if (!isAdmin) {
    const instanceUserRoleAlias = "iur";
    query.addJoin("genrpg", "instance_user_roles", instanceUserRoleAlias,
        `${qualify(instanceUserRoleAlias, "instance_guid")} = ${qualify(instanceAlias, "guid")}`,
      ).whereColumn(instanceUserRoleAlias, "user_guid", user.guid);
  }

  const result = await pool.query(query.toString(), query.params);
  return result.rows[0] || null;
}

async function getInstancePermissions(instanceGuid, userGuid) {
  const instanceUserRoleAlias = "iur";
  const rolePermissionAlias = "rp";
  const permissionAlias = "p";
  const query = selectQuery()
    .from("genrpg", "instance_user_roles", instanceUserRoleAlias)
    .addJoin("genrpg", "role_permissions", rolePermissionAlias,
      `${qualify(rolePermissionAlias, "role_id")} = ${qualify(instanceUserRoleAlias, "role_id")}`,
    )
    .addJoin("genrpg", "permissions", permissionAlias,
      `${qualify(permissionAlias, "id")} = ${qualify(rolePermissionAlias, "permission_id")}`,
    )
    .addExpression(`DISTINCT ${qualify(permissionAlias, "name")}`)
    .whereColumn(instanceUserRoleAlias, "instance_guid", instanceGuid)
    .whereColumn(instanceUserRoleAlias, "user_guid", userGuid);

  const result = await pool.query(query.toString(), query.params);
  return new Set(result.rows.map((row) => row.name));
}

async function getUserInstanceRole(instanceGuid, userGuid) {
  const tableAlias = "iur";
  const roleTableAlias = "r";
  const query = selectQuery()
    .from("genrpg", "instance_user_roles", tableAlias)
    .addJoin("genrpg", "roles", roleTableAlias,
      `${qualify(roleTableAlias, "id")} = ${qualify(tableAlias, "role_id")}`,
    )
    .addFields(roleTableAlias, "name", "role_name")
    .whereColumn(tableAlias, "instance_guid", instanceGuid)
    .whereColumn(tableAlias, "user_guid", userGuid);

  const result = await pool.query(query.toString(), query.params);
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

  if (typeof instance.packages === "string") {
    const packages = await loadPackages({ strict: true });
    instance.packages = resolveInstancePackages(instance.packages, packages);
  } else if (!instance.packages || typeof instance.packages !== "object" || Array.isArray(instance.packages)) {
    instance.packages = {};
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
