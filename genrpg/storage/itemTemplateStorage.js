const { BaseStorage } = require("../../src/storage/baseStorage");
const ItemTemplateEntity = require("../entities/itemTemplate");

class ItemTemplateStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "item_templates";
  static Entity = ItemTemplateEntity;

  async listEntities({ orderBy = [], ...filters } = {}) {
    const args = { ...filters };
    args.orderBy = orderBy.length ? orderBy : [
      { property: "name", nulls: "LAST" },
      { property: "createDatetime" },
    ];
    return super.listEntities(args);
  }
}

module.exports = ItemTemplateStorage;
