const { BaseStorage } = require("./baseStorage");
const { InventoryEntity } = require("../entities/inventoryEntity");

/**
 * Storage for character inventories (links a collection to a character).
 */
class InventoryStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "inventories";
  static Entity = InventoryEntity;

  async listEntities({ characterGuid, collectionGuid, ...options } = {}) {
    return super.listEntities({
      ...options,
      characterGuid,
      collectionGuid,
      orderBy: [{ field: "create_datetime" }],
    });
  }
}

module.exports = InventoryStorage;
