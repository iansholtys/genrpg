const { BaseStorage } = require("./baseStorage");
const { ItemCollectionContentEntity } = require("../entities/itemCollectionContentEntity");

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
      .where(`${t}.instance_guid = $1`, [this.instanceGuid])
      .where(`${t}.collection_guid = $1`, [collectionGuid])
      .orderBy(t, "position")
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
            collection_guid,
            item_guid,
            subcollection_guid,
            quantity,
            position
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          entity.guid,
          entity.instanceGuid,
          entity.collectionGuid,
          entity.itemGuid,
          entity.subcollectionGuid,
          entity.quantity,
          entity.position,
        ],
      );
      entity.isNew = false;
    } else {
      const result = await this.query(
        `
          UPDATE ${this.schema_table}
          SET
            item_guid = $1,
            subcollection_guid = $2,
            quantity = $3,
            position = $4
          WHERE guid = $5
            AND collection_guid = $6
            AND instance_guid = $7
          RETURNING guid
        `,
        [
          entity.itemGuid,
          entity.subcollectionGuid,
          entity.quantity,
          entity.position,
          entity.guid,
          entity.collectionGuid,
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
