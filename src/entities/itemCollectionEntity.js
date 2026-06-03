const { BaseEntity } = require("./baseEntity");
const { ItemEntity } = require("./itemEntity");

class ItemCollectionEntity extends BaseEntity {
  static getStorage() {
    return require("../storage/itemCollectionStorage");
  }

  static fields = {
    type: { label: "Type", type: "text", required: true },
    name: { label: "Name", type: "text" },
    itemGuid: { label: "Item", type: "guid", refs: ItemEntity },
    capacityUsed: { label: "Capacity used", type: "number" },
    capacityMax: { label: "Capacity max", type: "number" },
  };

  static readOnlyFields = ["createDatetime", "updateDatetime"];

  constructor(options = {}) {
    super(options);
    this.initFields(options);
  }

  async save() {
    this.assertInTransaction();
    this.assertHasStorage();
    this.assertValidated();
    return this.storage.saveCollection(this);
  }

  async delete() {
    this.assertInTransaction();
    this.assertHasStorage();
    return this.storage.deleteCollection(this.guid);
  }

  toJSON() {
    return {
      guid: this.guid,
      instanceGuid: this.instanceGuid,
      type: this.type,
      name: this.name,
      itemGuid: this.itemGuid,
      capacityUsed: this.capacityUsed,
      capacityMax: this.capacityMax,
      createDatetime: this.createDatetime,
      updateDatetime: this.updateDatetime,
    };
  }
}

module.exports = { ItemCollectionEntity };
