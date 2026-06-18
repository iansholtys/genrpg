/**
 * Central access control for API requests.
 */
const { pool } = require("../db/pool");
const { isGlobalAdmin } = require("../auth");
const { qualify, selectQuery } = require("./queryService");
const InstanceStorage = require("../../genrpg/storage/instanceStorage");
const UserStorage = require("../storage/userStorage");

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

  const instanceUserRoleAlias = "uir";
  const query = selectQuery()
    .from("genrpg", "user_instance_roles", instanceUserRoleAlias)
    .addFields(instanceUserRoleAlias, "entity_guid")
    .whereColumn(instanceUserRoleAlias, "instance_guid", instanceGuid)
    .whereColumn(instanceUserRoleAlias, "entity_guid", user.guid);

  const result = await pool.query(query.toString(), query.params);
  return result.rows.length > 0;
}

async function getInstancePermissions(instanceGuid, userGuid) {
  const instanceUserRoleAlias = "uir";
  const rolePermissionAlias = "rp";
  const permissionNameAlias = "pn";
  const schema = "genrpg";
  const query = selectQuery()
    .from(schema, "user_instance_roles", instanceUserRoleAlias)
    .addJoin(schema, "role_permissions", rolePermissionAlias,
      `${qualify(rolePermissionAlias, "entity_guid")} = ${qualify(instanceUserRoleAlias, "role_guid")}`,
    )
    .addJoin(schema, "permission_name", permissionNameAlias,
      `${qualify(permissionNameAlias, "entity_guid")} = ${qualify(rolePermissionAlias, "value")}`,
    )
    .addExpression(`DISTINCT ${qualify(permissionNameAlias, "value")}`, "name")
    .whereColumn(instanceUserRoleAlias, "instance_guid", instanceGuid)
    .whereColumn(instanceUserRoleAlias, "entity_guid", userGuid);

  const result = await pool.query(query.toString(), query.params);
  return new Set(result.rows.map((row) => row.name));
}

async function getUserInstanceRole(instanceGuid, userGuid) {
  const tableAlias = "uir";
  const roleNameAlias = "rn";
  const schema = "genrpg";
  const query = selectQuery()
    .from(schema, "user_instance_roles", tableAlias)
    .addJoin(schema, "role_name", roleNameAlias,
      `${qualify(roleNameAlias, "entity_guid")} = ${qualify(tableAlias, "role_guid")}`,
    )
    .addFields(roleNameAlias, "value", "role_name")
    .whereColumn(tableAlias, "instance_guid", instanceGuid)
    .whereColumn(tableAlias, "entity_guid", userGuid);

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

async function assignInstanceRole(userGuid, instanceGuid, roleGuid) {
  const user = await UserStorage.global().load(userGuid, { skipEvents: true });
  if (!user) {
    return null;
  }

  const roles = [...(user.instanceRoles ?? [])];
  const index = roles.findIndex((entry) => entry.instanceGuid === instanceGuid);
  const assignment = { instanceGuid, roleGuid };

  if (index >= 0) {
    roles[index] = assignment;
  } else {
    roles.push(assignment);
  }

  user.set({ instanceRoles: roles });
  const validationErrors = await user.validate();
  if (validationErrors.length) {
    throw new Error(validationErrors.join("; "));
  }

  await user.save({ skipEvents: true });
  return user;
}

module.exports = {
  loadAccessibleInstance,
  getUserInstanceRole,
  userHasPermission,
  buildContext,
  hasPermission,
  assignInstanceRole,
};
