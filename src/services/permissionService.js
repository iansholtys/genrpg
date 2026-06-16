/**
 * Central access control for API requests.
 */
const { pool } = require("../db/pool");
const { isGlobalAdmin } = require("../auth");
const { qualify, selectQuery } = require("./queryService");
const InstanceStorage = require("../../genrpg/storage/instanceStorage");

async function loadAccessibleInstance(instanceGuid, user, options = {}) {
  if (!(await userCanAccessInstance(instanceGuid, user))) {
    return null;
  }

  const instance = await InstanceStorage.global().load(instanceGuid, options);
  if (!instance) {
    return null;
  }

  return instance.resolvePackageNames();
}

async function userCanAccessInstance(instanceGuid, user) {
  if (await isGlobalAdmin(user.guid)) {
    return true;
  }

  const instanceUserRoleAlias = "iur";
  const query = selectQuery()
    .from("genrpg", "instance_user_roles", instanceUserRoleAlias)
    .addFields(instanceUserRoleAlias, "user_guid")
    .whereColumn(instanceUserRoleAlias, "instance_guid", instanceGuid)
    .whereColumn(instanceUserRoleAlias, "user_guid", user.guid);

  const result = await pool.query(query.toString(), query.params);
  return result.rows.length > 0;
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

async function buildContext(user, instanceGuid) {
  const isGlobalAdminUser = await isGlobalAdmin(user.guid);
  const instance = await loadAccessibleInstance(instanceGuid, user);
  if (!instance) {
    return null;
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
