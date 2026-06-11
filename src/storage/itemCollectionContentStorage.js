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
      .whereColumn(t, "instance_guid", this.instanceGuid)
      .whereColumn(t, "collection_guid", collectionGuid)
      .orderBy(t, "position")
      .orderBy(t, "create_datetime");

    const result = await this.query(query.toString(), query.params);
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
  }
}

module.exports = ItemCollectionContentStorage;
