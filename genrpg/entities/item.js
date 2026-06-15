const { BaseEntity } = require("../../src/entities/baseEntity");

class ItemEntity extends BaseEntity {
  static key = "item";
  static labelProperties = ["name"];

  static getStorage() {
    return require("../storage/itemStorage");
  }

  static async getFormSchema(context) {
    const storage = this.getStorage().forInstance(context.instance);
    const fieldSpecs = await storage.getFieldSpecs();

    const coreFields = await Promise.all(
      Object.entries(fieldSpecs)
        .filter(([, spec]) => !spec.readOnly && !spec.structured)
        .map(([key, spec]) => this.formFieldFromSpec(key, spec, { instance: context.instance })),
    );

    return {
      groups: [{ id: "core", label: "Item", fields: coreFields }],
    };
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
