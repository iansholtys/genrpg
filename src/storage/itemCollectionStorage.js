const { BaseStorage } = require("./baseStorage");
const { ItemCollectionEntity } = require("../entities/itemCollectionEntity");
const { qualify } = require("../services/queryService");

/**
 * Storage for item collections.
 */
class ItemCollectionStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "item_collections";
  static Entity = ItemCollectionEntity;

  async listEntities({ itemGuid, type, ...options } = {}) {
    const t = this.tableAlias;

    return super.listEntities({
      ...options,
      itemGuid,
      type,
      orderBy: [
        { field: "type" },
        { expression: `COALESCE(${qualify(t, "name")}, '')` },
        { field: "create_datetime" },
      ],
    });
  }
}

module.exports = ItemCollectionStorage;
