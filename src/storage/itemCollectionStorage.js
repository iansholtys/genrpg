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

  async listEntities({ itemGuid, type } = {}) {
    const query = await this.buildSelect();
    const t = this.tableAlias;

    query.whereColumn(t, "instance_guid", this.instanceGuid);

    if (itemGuid) {
      query.whereColumn(t, "item_guid", itemGuid);
    }

    if (type) {
      query.whereColumn(t, "type", type);
    }

    query
      .orderBy(t, "type")
      .orderBy(null, `COALESCE(${qualify(t, "name")}, '')`)
      .orderBy(t, "create_datetime");

    const result = await this.query(query.toString(), query.params);
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
  }
}

module.exports = ItemCollectionStorage;
