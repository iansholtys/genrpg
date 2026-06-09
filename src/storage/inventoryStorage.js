const { BaseStorage } = require("./baseStorage");
const { InventoryEntity } = require("../entities/inventoryEntity");
const { updateQuery } = require("../services/queryService");

/**
 * Storage for character inventories (links a collection to a character).
 */
class InventoryStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "inventories";
  static Entity = InventoryEntity;

  async listEntities({ characterGuid, collectionGuid } = {}) {
    const query = await this.buildSelect();
    const t = this.tableAlias;

    query.whereColumn(t, "instance_guid", this.instanceGuid);

    if (characterGuid) {
      query.whereColumn(t, "character_guid", characterGuid);
    }

    if (collectionGuid) {
      query.whereColumn(t, "collection_guid", collectionGuid);
    }

    query.orderBy(t, "create_datetime");

    const result = await this.query(query.toString(), query.params);
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
  }

  async save(entity) {
    const { guid, instanceGuid, collectionGuid, characterGuid } = entity;
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
        [guid, instanceGuid, collectionGuid, characterGuid],
      );
      entity.isNew = false;
    } else {
      const { schema, table } = this.constructor;
      const t = this.tableAlias;
      const query = updateQuery()
        .from(schema, table, t)
        .set(["collection_guid", "character_guid"], [collectionGuid, characterGuid])
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
      extensionFieldSpecs,
      packageData,
      collectionGuid: row.collection_guid,
      characterGuid: row.character_guid,
      createDatetime: row.create_datetime,
      updateDatetime: row.update_datetime,
      ...extensionValues,
    });
  }
}

module.exports = InventoryStorage;
