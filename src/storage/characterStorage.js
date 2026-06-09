const { BaseStorage } = require("./baseStorage");
const { updateQuery } = require("../services/queryService");

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
      .whereColumn(t, "instance_guid", this.instanceGuid)
      .orderBy(t, "display_name", "ASC", "NULLS LAST")
      .orderBy(t, "create_datetime");

    const result = await this.query(query.toString(), query.params);
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
  }

  async save(entity) {
    const { guid, instanceGuid, userGuid, displayName, fullName, appearance, pronouns } = entity;
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
        [guid, instanceGuid, userGuid, displayName, fullName, appearance, pronouns],
      );
      entity.isNew = false;
    } else {
      const { schema, table } = this.constructor;
      const t = this.tableAlias;
      const query = updateQuery()
        .from(schema, table, t)
        .set(["user_guid", "display_name", "full_name", "appearance", "pronouns"],
          [userGuid, displayName, fullName, appearance, pronouns])
        .whereColumn(t, "guid", guid)
        .whereColumn(t, "instance_guid", this.instanceGuid)
        .returning(t, "guid");

      const result = await this.query(query.toString(), query.params);
      if (!result.rows.length) {
        return null;
      }
    }

    await this.saveExtensionRowsForEntity(entity);

    const reloaded = await this.load(guid);
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
