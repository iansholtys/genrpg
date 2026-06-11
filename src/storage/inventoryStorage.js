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
}

module.exports = InventoryStorage;
