const { BaseEntity } = require("./baseEntity");
const { ItemEntity } = require("./itemEntity");
const { ItemCollectionEntity } = require("./itemCollectionEntity");

class ItemCollectionContentEntity extends BaseEntity {
  static getStorage() {
    return require("../storage/itemCollectionStorage");
  }

  static fields = {
    itemGuid: { label: "Item", type: "guid", refs: ItemEntity },
    subcollectionGuid: { label: "Subcollection", type: "guid", refs: ItemCollectionEntity },
    quantity: { label: "Quantity", type: "integer", required: true, default: 1 },
    position: { label: "Position", type: "integer", required: true, default: 0 },
    collectionGuid: { readOnly: true },
    createDatetime: { readOnly: true },
    updateDatetime: { readOnly: true },
  };

  constructor(options = {}) {
    super(options);
    this.initFields(options);
  }

  async collectValidationErrors() {
    const errors = await super.collectValidationErrors();

    const hasItem = Boolean(this.itemGuid);
    const hasSubcollection = Boolean(this.subcollectionGuid);

    if (Number(hasItem) + Number(hasSubcollection) !== 1) {
      errors.push("Either item or subcollection is required");
    }
    if (Number.isInteger(this.quantity) && this.quantity < 0) {
      errors.push("Quantity must be at least 0");
    }
    if (hasSubcollection && this.subcollectionGuid === this.collectionGuid) {
      errors.push("A collection cannot contain itself");
    }

    return errors;
  }

  async save() {
    this.assertInTransaction();
    this.assertHasStorage();
    this.assertValidated();
    return this.storage.saveContent(this);
  }

  async delete() {
    this.assertInTransaction();
    this.assertHasStorage();
    return this.storage.deleteContent(this.collectionGuid, this.guid);
  }

  toJSON() {
    return {
      guid: this.guid,
      instanceGuid: this.instanceGuid,
      collectionGuid: this.collectionGuid,
      itemGuid: this.itemGuid,
      subcollectionGuid: this.subcollectionGuid,
      quantity: this.quantity,
      position: this.position,
      createDatetime: this.createDatetime,
      updateDatetime: this.updateDatetime,
    };
  }
}

module.exports = { ItemCollectionContentEntity };
