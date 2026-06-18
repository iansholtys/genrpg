const { BaseStorage } = require("./baseStorage");
const RoleEntity = require("../../genrpg/entities/role");
const { selectQuery } = require("../services/queryService");

class RoleStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "roles";
  static Entity = RoleEntity;

  static get instanceScoped() {
    return false;
  }

  async listEntities({ orderBy = [], ...filters } = {}) {
    const args = { ...filters };
    args.orderBy = orderBy.length ? orderBy : [{ property: "name" }];
    return super.listEntities(args);
  }

  /**
   * Count users assigned this role on any instance.
   * @param {string} roleGuid
   */
  async countUsersWithRole(roleGuid) {
    const tableAlias = "uir";
    const query = selectQuery()
      .from("genrpg", "user_instance_roles", tableAlias)
      .addExpression("COUNT(*)", "count")
      .whereColumn(tableAlias, "role_guid", roleGuid);

    const result = await this.query(query.toString(), query.params);
    return Number(result.rows[0]?.count ?? 0);
  }
}

module.exports = RoleStorage;
