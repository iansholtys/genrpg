const { BaseStorage } = require("../../src/storage/baseStorage");
const ItemEntity = require("../entities/item");

class ItemStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "items";
  static Entity = ItemEntity;

  async listEntities({ orderBy = [], ...filters } = {}) {
    const args = { ...filters };
    args.orderBy = orderBy.length ? orderBy : [
      { property: "name", nulls: "LAST" },
      { property: "createDatetime" },
    ];
    return super.listEntities(args);
  }
}

module.exports = ItemStorage;
