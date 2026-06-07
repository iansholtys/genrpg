const { BaseEntity } = require("./baseEntity");

class ItemTemplateEntity extends BaseEntity {
  static getStorage() {
    return require("../storage/itemTemplateStorage");
  }

  static fields = {
    name: { label: "Name", type: "text", required: true },
    description: { label: "Description", type: "text", inputType: "textarea" },
    weight: { label: "Weight", type: "number" },
    createDatetime: { readOnly: true },
    updateDatetime: { readOnly: true },
  };

  constructor(options = {}) {
    super(options);
    this.initFields(options);
  }

  toJSON() {
    return {
      guid: this.guid,
      instanceGuid: this.instanceGuid,
      name: this.name,
      description: this.description,
      weight: this.weight,
      createDatetime: this.createDatetime,
      updateDatetime: this.updateDatetime,
    };
  }
}

module.exports = { ItemTemplateEntity };
