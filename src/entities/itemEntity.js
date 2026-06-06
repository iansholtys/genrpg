const { BaseEntity } = require("./baseEntity");
const { ItemTemplateEntity } = require("./itemTemplateEntity");
const { mergeExtensionFieldSpecs } = require("../lib/entityExtensionIndex");

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
  };

  static readOnlyFields = [
    "createDatetime",
    "updateDatetime",
    "itemTemplate",
    "effectiveName",
    "effectiveDescription",
    "effectiveWeight",
    "packageData",
  ];

  constructor(options = {}) {
    super(options);
    this.initFields(options);
  }

  static async getFormSchema(context) {
    const ItemTemplateStorage = require("../storage/itemTemplateStorage");

    const packageNames = Object.keys(context.instance.packages);
    const extensionFieldSpecs = mergeExtensionFieldSpecs(
      ItemEntity.key,
      packageNames,
      Object.keys(ItemEntity.fields),
    );
    const templates = await ItemTemplateStorage.forInstance(context.instance).list();

    const coreFields = Object.entries(ItemEntity.fields).map(([key, spec]) => {
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
      itemTemplate: this.itemTemplate,
      effectiveName: this.effectiveName,
      effectiveDescription: this.effectiveDescription,
      effectiveWeight: this.effectiveWeight,
      ...super.toJSON(),
    };
  }
}

module.exports = { ItemEntity };
