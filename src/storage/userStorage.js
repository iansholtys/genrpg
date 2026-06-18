const { BaseStorage } = require("./baseStorage");
const UserEntity = require("../entities/userEntity");
const { selectQuery, qualify } = require("../services/queryService");

class UserStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "users";
  static Entity = UserEntity;

  static get instanceScoped() {
    return false;
  }

  async listEntities({ orderBy = [], ...filters } = {}) {
    const args = { ...filters };
    args.orderBy = orderBy.length ? orderBy : [
      { property: "displayName", nulls: "LAST" },
      { property: "email" },
    ];
    return super.listEntities(args);
  }

  async listForInstance(instanceGuid, options = {}) {
    const tableAlias = "uir";
    const roleNameAlias = "rn";
    const schema = "genrpg";
    const rolesQuery = selectQuery()
      .from(schema, "user_instance_roles", tableAlias)
      .addJoin(schema, "role_name", roleNameAlias,
        `${qualify(roleNameAlias, "entity_guid")} = ${qualify(tableAlias, "role_guid")}`,
      )
      .addFields(tableAlias, ["entity_guid", "role_guid"])
      .addFields(roleNameAlias, ["value"], ["role_name"])
      .whereColumn(tableAlias, "instance_guid", instanceGuid);

    const rolesResult = await this.query(rolesQuery.toString(), rolesQuery.params);
    const assignments = rolesResult.rows.map((row) => ({
      userGuid: row.entity_guid,
      roleGuid: row.role_guid,
      roleName: row.role_name,
    }));

    if (!assignments.length) {
      return [];
    }

    const userGuids = [...new Set(assignments.map((entry) => entry.userGuid))];
    const users = await this.load(userGuids, options);
    const userByGuid = new Map(users.map((user) => [user.guid, user]));

    for (const user of userByGuid.values()) {
      user.instanceRoles = [];
    }

    for (const assignment of assignments) {
      userByGuid.get(assignment.userGuid)?.instanceRoles.push({
        roleGuid: assignment.roleGuid,
        roleName: assignment.roleName,
      });
    }

    return users;
  }
}

module.exports = UserStorage;
