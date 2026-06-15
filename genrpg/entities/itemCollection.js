const { BaseEntity } = require("../../src/entities/baseEntity");

class ItemCollectionEntity extends BaseEntity {
  static key = "item_collection";
  static labelProperties = ["name", "type"];

  static getStorage() {
    return require("../storage/itemCollectionStorage");
  }

  async collectValidationErrors() {
    const errors = await super.collectValidationErrors();

    if (!Array.isArray(this.contents)) {
      return errors;
    }

    for (const entry of this.contents) {
      const hasItem = Boolean(entry?.itemGuid);
      const hasSubcollection = Boolean(entry?.subcollectionGuid);

      if (Number(hasItem) + Number(hasSubcollection) !== 1) {
        errors.push("Each collection entry must reference either an item or a subcollection");
      }
      if (Number.isInteger(entry?.quantity) && entry.quantity < 0) {
        errors.push("Quantity must be at least 0");
      }
      if (hasSubcollection && entry.subcollectionGuid === this.guid) {
        errors.push("A collection cannot contain itself");
      }
    }

    return errors;
  }
}

module.exports = ItemCollectionEntity;
