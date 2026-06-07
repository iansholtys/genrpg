const { BaseStorage } = require("./baseStorage");
const { UserEntity } = require("../entities/userEntity");

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
    const result = await this.query(
      `${query.toString()}
        ORDER BY ${t}.display_name ASC NULLS LAST, ${t}.email ASC
      `,
    );
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
  }

  async listForInstance(instanceGuid) {
    const query = await this.buildSelect();
    const t = this.tableAlias;

    query
      .addJoin("genrpg", "instance_user_roles", "iur", `iur.user_guid = ${t}.guid`)
      .where(`iur.instance_guid = $1`, [instanceGuid]);

    const result = await this.query(
      `${query.toString()}
        ORDER BY ${t}.display_name ASC NULLS LAST, ${t}.email ASC
      `,
      query.params,
    );
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
  }

  async loadEntity(userGuids) {
    const query = await this.buildSelect();
    const t = this.tableAlias;

    query.where(`${t}.guid = ANY($1)`, [userGuids]);

    const result = await this.query(query.toString(), query.params);
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
  }

  async save(entity) {
    if (entity.isNew) {
      throw new Error("Users are created via OIDC login, not entity.save()");
    }

    const result = await this.query(
      `
        UPDATE ${this.schema_table}
        SET email = $1, display_name = $2, admin = $3
        WHERE guid = $4
        RETURNING guid
      `,
      [entity.email, entity.displayName, entity.admin, entity.guid],
    );
    if (!result.rows.length) {
      return null;
    }

    const reloaded = await this.load(entity.guid);
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
