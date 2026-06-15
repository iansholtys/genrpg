const { BaseEntity } = require("../../src/entities/baseEntity");

class ItemEntity extends BaseEntity {
  static key = "item";
  static labelProperties = ["name"];

  static getStorage() {
    return require("../storage/itemStorage");
  }

  toJSON() {
    const payload = super.toJSON();
    if (this.itemTemplate != null) {
      payload.itemTemplate = typeof this.itemTemplate.toJSON === "function"
        ? this.itemTemplate.toJSON()
        : this.itemTemplate;
    }
    return payload;
  }
}

module.exports = ItemEntity;
