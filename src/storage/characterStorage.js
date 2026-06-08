const { BaseStorage } = require("./baseStorage");

class CharacterStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "characters";

  static get Entity() {
    return require("../entities/characterEntity").CharacterEntity;
  }

  async listEntities() {
    const query = await this.buildSelect();
    const t = this.tableAlias;

    query
      .where(`${t}.instance_guid = $1`, [this.instanceGuid])
      .orderBy(t, "display_name", "ASC", "NULLS LAST")
      .orderBy(t, "create_datetime");

    const result = await this.query(query.toString(), query.params);
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
  }

  async save(entity) {
    if (entity.isNew) {
      await this.query(
        `
          INSERT INTO ${this.schema_table} (
            guid,
            instance_guid,
            user_guid,
            display_name,
            full_name,
            appearance,
            pronouns
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          entity.guid,
          entity.instanceGuid,
          entity.userGuid,
          entity.displayName,
          entity.fullName,
          entity.appearance,
          entity.pronouns,
        ],
      );
      entity.isNew = false;
    } else {
      const result = await this.query(
        `
          UPDATE ${this.schema_table}
          SET
            user_guid = $1,
            display_name = $2,
            full_name = $3,
            appearance = $4,
            pronouns = $5
          WHERE guid = $6 AND instance_guid = $7
          RETURNING guid
        `,
        [
          entity.userGuid,
          entity.displayName,
          entity.fullName,
          entity.appearance,
          entity.pronouns,
          entity.guid,
          entity.instanceGuid,
        ],
      );
      if (!result.rows.length) {
        return null;
      }
    }

    await this.saveExtensionRowsForEntity(entity);

    const reloaded = await this.load(entity.guid);
    if (reloaded) {
      Object.assign(entity, {
        userGuid: reloaded.userGuid,
        displayName: reloaded.displayName,
        fullName: reloaded.fullName,
        appearance: reloaded.appearance,
        pronouns: reloaded.pronouns,
        createDatetime: reloaded.createDatetime,
        updateDatetime: reloaded.updateDatetime,
        packageData: reloaded.packageData,
      });
      this.assignExtensionFieldsFromReload(entity, reloaded);
    }

    return entity;
  }

  async toEntity(row) {
    const { extensionFieldSpecs, packageData, extensionValues } = await this.extensionContextFromRow(row);

    return new this.constructor.Entity({
      instanceGuid: row.instance_guid,
      guid: row.guid,
      isNew: false,
      storage: this,
      extensionFieldSpecs,
      packageData,
      userGuid: row.user_guid,
      displayName: row.display_name,
      fullName: row.full_name,
      appearance: row.appearance,
      pronouns: row.pronouns,
      createDatetime: row.create_datetime,
      updateDatetime: row.update_datetime,
      ...extensionValues,
    });
  }
}

module.exports = CharacterStorage;
