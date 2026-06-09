const { BaseStorage } = require("./baseStorage");
const { UserEntity } = require("../entities/userEntity");
const { updateQuery, qualify } = require("../services/queryService");

class UserStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "users";
  static Entity = UserEntity;

  static get instanceScoped() {
    return false;
  }

  async listEntities() {
    const query = await this.buildSelect();
    const t = this.tableAlias;

    query.orderBy(t, "display_name", "ASC", "NULLS LAST").orderBy(t, "email");

    const result = await this.query(query.toString());
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
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

    const t = this.tableAlias;
    const { guid, email, displayName, admin } = entity;
    const query = updateQuery()
      .from("genrpg", "users", t)
      .set(["email", "display_name", "admin"], [email, displayName, admin])
      .whereColumn(t, "guid", guid)
      .returning(t, "guid");

    const result = await this.query(query.toString(), query.params);
    if (!result.rows.length) {
      return null;
    }

    const reloaded = await this.load(guid);
    if (reloaded) {
      Object.assign(entity, {
        email: reloaded.email,
        displayName: reloaded.displayName,
        admin: reloaded.admin,
        createDatetime: reloaded.createDatetime,
        updateDatetime: reloaded.updateDatetime,
      });
    }

    return entity;
  }

  toEntity(row) {
    return new UserEntity({
      guid: row.guid,
      isNew: false,
      storage: this,
      oidcIssuer: row.oidc_issuer,
      oidcSubject: row.oidc_subject,
      email: row.email,
      displayName: row.display_name,
      admin: row.admin,
      createDatetime: row.create_datetime,
      updateDatetime: row.update_datetime,
    });
  }
}

module.exports = UserStorage;
