const { BaseStorage } = require("../../src/storage/baseStorage");
const ItemCollectionEntity = require("../entities/itemCollection");

class ItemCollectionStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "item_collections";
  static Entity = ItemCollectionEntity;

  async listEntities({ itemGuid, type, orderBy = [], ...options } = {}) {
    const args = { ...options, itemGuid, type };
    args.orderBy = orderBy.length ? orderBy : [
      { property: "type" },
      { property: "name", nulls: "LAST" },
      { property: "createDatetime" },
    ];
    return super.listEntities(args);
  }
}

module.exports = ItemCollectionStorage;
