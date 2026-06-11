const { BaseStorage } = require("./baseStorage");
const { ItemTemplateEntity } = require("../entities/itemTemplateEntity");

class ItemTemplateStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "item_templates";
  static Entity = ItemTemplateEntity;

  async listEntities(options = {}) {
    return super.listEntities({
      ...options,
      orderBy: [{ field: "name", nulls: "LAST" }, { field: "create_datetime" }],
    });
  }
}

module.exports = ItemTemplateStorage;
