const { BaseStorage } = require("./baseStorage");
const { ItemCollectionContentEntity } = require("../entities/itemCollectionContentEntity");
const { insertQuery, updateQuery } = require("../services/queryService");

/**
 * Storage for rows in item_collection_contents.
 */
class ItemCollectionContentStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "item_collection_contents";
  static Entity = ItemCollectionContentEntity;

  async create({ collectionGuid } = {}) {
    if (!collectionGuid) {
      throw new Error("collectionGuid is required");
    }

    const extensionFieldSpecs = await this.getExtensionFieldSpecs();
    return new this.constructor.Entity({
      instanceGuid: this.instanceGuid,
      guid: this.newGuid(),
      isNew: true,
      storage: this,
      extensionFieldSpecs,
      collectionGuid,
    });
  }

  async listEntities({ collectionGuid } = {}) {
    if (!collectionGuid) {
      throw new Error("collectionGuid is required");
    }

    const query = await this.buildSelect();
    const t = this.tableAlias;

    query
      .whereColumn(t, "instance_guid", this.instanceGuid)
      .whereColumn(t, "collection_guid", collectionGuid)
      .orderBy(t, "position")
      .orderBy(t, "create_datetime");

    const result = await this.query(query.toString(), query.params);
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
  }

  async save(entity) {
    const { guid, instanceGuid, collectionGuid, itemGuid, subcollectionGuid, quantity, position } = entity;
    if (entity.isNew) {
      const { schema, table } = this.constructor;
      const insert = insertQuery()
        .into(schema, table)
        .values(
          ["guid", "instance_guid", "collection_guid", "item_guid", "subcollection_guid", "quantity", "position"],
          [guid, instanceGuid, collectionGuid, itemGuid, subcollectionGuid, quantity, position],
        );

      await this.query(insert.toString(), insert.params);
      entity.isNew = false;
    } else {
      const { schema, table } = this.constructor;
      const t = this.tableAlias;
      const query = updateQuery()
        .from(schema, table, t)
        .set(["item_guid", "subcollection_guid", "quantity", "position"], [
          itemGuid,
          subcollectionGuid,
          quantity,
          position,
        ])
        .whereColumn(t, "guid", guid)
        .whereColumn(t, "collection_guid", collectionGuid)
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
        itemGuid: reloaded.itemGuid,
        subcollectionGuid: reloaded.subcollectionGuid,
        quantity: reloaded.quantity,
        position: reloaded.position,
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
      itemGuid: row.item_guid,
      subcollectionGuid: row.subcollection_guid,
      quantity: row.quantity,
      position: row.position,
      createDatetime: row.create_datetime,
      updateDatetime: row.update_datetime,
      ...extensionValues,
    });
  }
}

module.exports = ItemCollectionContentStorage;
