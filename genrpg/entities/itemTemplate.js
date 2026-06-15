const { BaseEntity } = require("../../src/entities/baseEntity");

class ItemTemplateEntity extends BaseEntity {
  static key = "item_template";
  static labelProperties = ["name"];

  static getStorage() {
    return require("../storage/itemTemplateStorage");
  }
}

module.exports = ItemTemplateEntity;
