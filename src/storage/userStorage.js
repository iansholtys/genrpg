const { BaseStorage } = require("./baseStorage");
const UserEntity = require("../entities/userEntity");
const { qualify, selectQuery } = require("../services/queryService");

class UserStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "users";
  static Entity = UserEntity;

  static get instanceScoped() {
    return false;
  }

  async listEntities({ orderBy = [], ...filters } = {}) {
    const args = { ...filters };
    if (orderBy.length) {
      args.orderBy = orderBy;
    } else {
      args.orderBy = [
        { property: "displayName", nulls: "LAST" },
        { property: "email" },
      ];
    }
    return super.listEntities(args);
  }

  async listForInstance(instanceGuid, options = {}) {
    const tableAlias = "iur";
    const roleTableAlias = "r";
    const schema = "genrpg";
    const rolesQuery = selectQuery()
      .from(schema, "instance_user_roles", tableAlias)
      .addJoin(schema, "roles", roleTableAlias,
        `${qualify(roleTableAlias, "id")} = ${qualify(tableAlias, "role_id")}`,
      )
      .addFields(tableAlias, ["user_guid", "role_id"])
      .addFields(roleTableAlias, ["name"], ["role_name"])
      .whereColumn(tableAlias, "instance_guid", instanceGuid);

    const rolesResult = await this.query(rolesQuery.toString(), rolesQuery.params);
    const assignments = rolesResult.rows.map((row) => ({
      userGuid: row.user_guid,
      roleId: row.role_id,
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
        roleId: assignment.roleId,
        roleName: assignment.roleName,
      });
    }

    return users;
  }
}

module.exports = UserStorage;
