const { BaseStorage } = require("./baseStorage");
const { ItemTemplateEntity } = require("../entities/itemTemplateEntity");

class ItemTemplateStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "item_templates";
  static Entity = ItemTemplateEntity;

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

module.exports = ItemTemplateStorage;
