const { BaseEntity } = require("./baseEntity");
const { ItemTemplateEntity } = require("./itemTemplateEntity");

class ItemEntity extends BaseEntity {
  static getStorage() {
    return require("../storage/itemStorage");
  }

  static fields = {
    itemTemplateGuid: {
      label: "Item template",
      type: "guid",
      required: true,
      refs: ItemTemplateEntity,
    },
    name: { label: "Name", type: "text" },
    description: { label: "Description", type: "text" },
    weight: { label: "Weight", type: "number" },
  };

  static readOnlyFields = [
    "createDatetime",
    "updateDatetime",
    "itemTemplate",
    "effectiveName",
    "effectiveDescription",
    "effectiveWeight",
  ];

  constructor(options = {}) {
    super(options);
    this.initFields(options);
  }

  toJSON() {
    return {
      guid: this.guid,
      instanceGuid: this.instanceGuid,
      itemTemplateGuid: this.itemTemplateGuid,
      name: this.name,
      description: this.description,
      weight: this.weight,
      createDatetime: this.createDatetime,
      updateDatetime: this.updateDatetime,
      itemTemplate: this.itemTemplate,
      effectiveName: this.effectiveName,
      effectiveDescription: this.effectiveDescription,
      effectiveWeight: this.effectiveWeight,
    };
  }
}

module.exports = { ItemEntity };
