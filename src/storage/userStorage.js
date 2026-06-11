const { BaseStorage } = require("./baseStorage");
const { UserEntity } = require("../entities/userEntity");
const { qualify } = require("../services/queryService");

class UserStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "users";
  static Entity = UserEntity;

  static get instanceScoped() {
    return false;
  }

  async listEntities(options = {}) {
    return super.listEntities({
      ...options,
      orderBy: [{ field: "display_name", nulls: "LAST" }, { field: "email" }],
    });
  }

  async listForInstance(instanceGuid) {
    const query = await this.buildSelect();
    const t = this.tableAlias;

    query
      .addJoin(
        "genrpg",
        "instance_user_roles",
        "iur",
        `${qualify("iur", "user_guid")} = ${qualify(t, "guid")}`,
      )
      .whereColumn("iur", "instance_guid", instanceGuid)
      .orderBy(t, "display_name", "ASC", "NULLS LAST")
      .orderBy(t, "email");

    const result = await this.query(query.toString(), query.params);
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
  }

  async save(entity) {
    if (entity.isNew) {
      throw new Error("Users are created via OIDC login, not entity.save()");
    }
    return super.save(entity);
  }
}

module.exports = UserStorage;
