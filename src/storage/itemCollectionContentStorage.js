const { BaseStorage } = require("./baseStorage");
const { ItemCollectionContentEntity } = require("../entities/itemCollectionContentEntity");

/**
 * Storage for rows in item_collection_contents.
 */
class ItemCollectionContentStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "item_collection_contents";
  static Entity = ItemCollectionContentEntity;

  async listEntities({ collectionGuid, ...options } = {}) {
    if (!collectionGuid) {
      throw new Error("collectionGuid is required");
    }

    return super.listEntities({
      ...options,
      collectionGuid,
      orderBy: [
        { field: "position" },
        { field: "create_datetime" },
      ],
    });
  }
}

module.exports = ItemCollectionContentStorage;
