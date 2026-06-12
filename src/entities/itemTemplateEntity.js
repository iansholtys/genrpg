const { BaseEntity } = require("./baseEntity");

class ItemTemplateEntity extends BaseEntity {
  static key = "item_template";

  static getStorage() {
    return require("../storage/itemTemplateStorage");
  }

  static fields = {
    name: { label: "Name", type: "text", required: true },
    description: { label: "Description", type: "text", inputType: "textarea" },
    weight: { label: "Weight", type: "number" },
    createDatetime: { readOnly: true },
    updateDatetime: { readOnly: true },
    packageData: { readOnly: true, virtual: true, default: {} },
  };

  constructor(options = {}) {
    super(options);
    this.initFields(options);
  }

  static async getFormSchema(context) {
    const extensionFieldSpecs = await this.getStorage().forInstance(context.instance).getExtensionFieldSpecs();

    const coreFields = Object.entries(ItemTemplateEntity.fields)
      .filter(([, spec]) => !spec.readOnly)
      .map(([key, spec]) => this.formFieldFromSpec(key, spec));

    const groups = [
      { id: "core", label: "Item Template", fields: coreFields },
      ...this.buildExtensionFormGroups(extensionFieldSpecs, context),
    ];

    return { groups: groups.filter((group) => group.fields.length) };
  }
}

module.exports = { ItemTemplateEntity };
