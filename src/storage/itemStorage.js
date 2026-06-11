const { BaseStorage } = require("./baseStorage");
const { ItemEntity } = require("../entities/itemEntity");

class ItemStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "items";
  static Entity = ItemEntity;

  async listEntities() {
    const query = await this.buildSelect();
    const t = this.tableAlias;

    query
      .whereColumn(t, "instance_guid", this.instanceGuid)
      .orderBy(t, "name", "ASC", "NULLS LAST")
      .orderBy(t, "create_datetime");

    const result = await this.query(query.toString(), query.params);
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
  }
}

module.exports = ItemStorage;
