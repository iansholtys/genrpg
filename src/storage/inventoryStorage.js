const { BaseStorage } = require("./baseStorage");
const { InventoryEntity } = require("../entities/inventoryEntity");

/**
 * Storage for character inventories (links a collection to a character).
 */
class InventoryStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "inventories";
  static Entity = InventoryEntity;

  async listEntities({ characterGuid, collectionGuid } = {}) {
    const { sql } = await this.buildInventorySelect();
    const params = [this.instanceGuid];
    const conditions = ["inv.instance_guid = $1"];

    if (characterGuid) {
      params.push(characterGuid);
      conditions.push(`inv.character_guid = $${params.length}`);
    }

    if (collectionGuid) {
      params.push(collectionGuid);
      conditions.push(`inv.collection_guid = $${params.length}`);
    }

    const result = await this.query(
      `${sql}
        WHERE ${conditions.join(" AND ")}
        ORDER BY inv.create_datetime ASC
      `,
      params,
    );
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
  }

  async loadEntity(inventoryGuid) {
    const { sql } = await this.buildInventorySelect();
    const result = await this.query(
      `${sql}
        WHERE inv.guid = $1 AND inv.instance_guid = $2
      `,
      [inventoryGuid, this.instanceGuid],
    );
    return result.rows[0] ? this.toEntity(result.rows[0]) : null;
  }

  async save(entity) {
    if (entity.isNew) {
      await this.query(
        `
          INSERT INTO ${this.schema_table} (
            guid,
            instance_guid,
            collection_guid,
            character_guid
          )
          VALUES ($1, $2, $3, $4)
        `,
        [entity.guid, entity.instanceGuid, entity.collectionGuid, entity.characterGuid],
      );
      entity.isNew = false;
    } else {
      const result = await this.query(
        `
          UPDATE ${this.schema_table}
          SET collection_guid = $1, character_guid = $2
          WHERE guid = $3 AND instance_guid = $4
          RETURNING guid
        `,
        [entity.collectionGuid, entity.characterGuid, entity.guid, entity.instanceGuid],
      );
      if (!result.rows.length) {
        return null;
      }
    }

    await this.saveExtensionRowsForEntity(entity);

    const reloaded = await this.load(entity.guid);
    if (reloaded) {
      Object.assign(entity, {
        collectionGuid: reloaded.collectionGuid,
        characterGuid: reloaded.characterGuid,
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
      collectionGuid: row.collection_guid,
      characterGuid: row.character_guid,
      createDatetime: row.create_datetime,
      updateDatetime: row.update_datetime,
      ...extensionValues,
    });
  }

  async buildInventorySelect() {
    const { joins, packageExtensionsSql } = await this.getExtensionJoinSql("inv");

    return {
      sql: `
        SELECT
          inv.guid,
          inv.instance_guid,
          inv.collection_guid,
          inv.character_guid,
          inv.create_datetime,
          inv.update_datetime,
          ${packageExtensionsSql} AS package_extensions
        FROM ${this.schema_table} inv
        ${joins.join("\n        ")}
      `,
    };
  }
}

module.exports = InventoryStorage;
