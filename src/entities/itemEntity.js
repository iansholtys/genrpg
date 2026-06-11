const { BaseEntity } = require("./baseEntity");
const { ItemTemplateEntity } = require("./itemTemplateEntity");

class ItemEntity extends BaseEntity {
  static key = "item";

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
    description: { label: "Description", type: "text", inputType: "textarea" },
    weight: { label: "Weight", type: "number" },
    createDatetime: { readOnly: true },
    updateDatetime: { readOnly: true },
    itemTemplate: { readOnly: true, virtual: true },
    packageData: { readOnly: true, virtual: true, default: {} },
  };

  constructor(options = {}) {
    super(options);
    this.initFields(options);
  }

  static async getFormSchema(context) {
    const ItemTemplateStorage = require("../storage/itemTemplateStorage");

    const extensionFieldSpecs = await this.getStorage().forInstance(context.instance).getExtensionFieldSpecs();
    const templates = await ItemTemplateStorage.forInstance(context.instance).list();

    const coreFields = Object.entries(ItemEntity.fields)
      .filter(([, spec]) => !spec.readOnly)
      .map(([key, spec]) => {
      if (key === "itemTemplateGuid") {
        return this.formFieldFromSpec(key, spec, {
          inputType: "select",
          options: templates.map((template) => ({
            value: template.guid,
            label: template.name || template.guid,
          })),
        });
      }
      return this.formFieldFromSpec(key, spec);
    });

    const groups = [
      { id: "core", label: "Item", fields: coreFields },
      ...this.buildExtensionFormGroups(extensionFieldSpecs, context),
    ];

    return { groups: groups.filter((group) => group.fields.length) };
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
      itemTemplate: this.itemTemplate ? this.itemTemplate.toJSON() : null,
      ...super.toJSON(),
    };
  }
}

module.exports = { ItemEntity };
