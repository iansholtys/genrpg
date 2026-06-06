const { BaseStorage } = require("./baseStorage");

class CharacterStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "characters";

  static get Entity() {
    return require("../entities/characterEntity").CharacterEntity;
  }

  async listEntities() {
    const { sql } = await this.buildCharacterSelect();
    const result = await this.query(
      `${sql}
        WHERE c.instance_guid = $1
        ORDER BY c.display_name ASC NULLS LAST, c.create_datetime ASC
      `,
      [this.instanceGuid],
    );
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
  }

  async loadEntity(characterGuid) {
    const { sql } = await this.buildCharacterSelect();
    const result = await this.query(
      `${sql}
        WHERE c.guid = $1 AND c.instance_guid = $2
      `,
      [characterGuid, this.instanceGuid],
    );
    return result.rows[0] ? this.toEntity(result.rows[0]) : null;
  }

  async create(userGuid) {
    if (!userGuid) {
      throw new Error("userGuid is required to create a character");
    }

    const extensionFieldSpecs = await this.getExtensionFieldSpecs();
    return new this.constructor.Entity({
      instanceGuid: this.instanceGuid,
      guid: this.newGuid(),
      isNew: true,
      storage: this,
      packageNames: this.packageNames,
      extensionFieldSpecs,
      userGuid,
    });
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
            display_name = $1,
            full_name = $2,
            appearance = $3,
            pronouns = $4
          WHERE guid = $5 AND instance_guid = $6
          RETURNING guid
        `,
        [
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
      packageNames: this.packageNames,
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

  async buildCharacterSelect() {
    const { joins, packageExtensionsSql } = await this.getExtensionJoinSql("c");

    return {
      sql: `
        SELECT
          c.guid,
          c.instance_guid,
          c.user_guid,
          c.display_name,
          c.full_name,
          c.appearance,
          c.pronouns,
          c.create_datetime,
          c.update_datetime,
          ${packageExtensionsSql} AS package_extensions
        FROM ${this.schema_table} c
        ${joins.join("\n        ")}
      `,
    };
  }
}

module.exports = CharacterStorage;
