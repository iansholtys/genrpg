const { BaseStorage } = require("./baseStorage");
const { ItemEntity } = require("../entities/itemEntity");

class ItemStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "items";
  static Entity = ItemEntity;

  async listEntities(options = {}) {
    return super.listEntities({
      ...options,
      orderBy: [{ field: "name", nulls: "LAST" }, { field: "create_datetime" }],
    });
  }
}

module.exports = ItemStorage;
