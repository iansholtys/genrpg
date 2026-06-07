const { mergeExtensionFieldSpecs } = require("../lib/entityExtensionIndex");
const { BaseEntity } = require("./baseEntity");
const { ItemEntity } = require("./itemEntity");

class ItemCollectionEntity extends BaseEntity {
  static key = "item_collection";

  static getStorage() {
    return require("../storage/itemCollectionStorage");
  }

  static fields = {
    type: { label: "Type", type: "text", required: true },
    name: { label: "Name", type: "text" },
    itemGuid: { label: "Item", type: "guid", refs: ItemEntity },
    capacityUsed: { label: "Capacity used", type: "number" },
    capacityMax: { label: "Capacity max", type: "number" },
    createDatetime: { readOnly: true },
    updateDatetime: { readOnly: true },
    packageData: { readOnly: true, virtual: true, default: {} },
  };

  constructor(options = {}) {
    super(options);
    this.initFields(options);
  }

  static async getFormSchema(context) {
    const ItemStorage = require("../storage/itemStorage");

    const packageNames = Object.keys(context.instance.packages);
    const extensionFieldSpecs = mergeExtensionFieldSpecs(
      ItemCollectionEntity.key,
      packageNames,
      Object.keys(ItemCollectionEntity.fields),
    );
    const items = await ItemStorage.forInstance(context.instance).list();

    const coreFields = Object.entries(ItemCollectionEntity.fields)
      .filter(([, spec]) => !spec.readOnly)
      .map(([key, spec]) => {
        if (key === "itemGuid") {
          return this.formFieldFromSpec(key, spec, {
            inputType: "select",
            options: items.map((item) => ({
              value: item.guid,
              label: item.name || item.guid,
            })),
          });
        }
        return this.formFieldFromSpec(key, spec);
      });

    const groups = [
      { id: "core", label: "Item Collection", fields: coreFields },
      ...this.buildExtensionFormGroups(extensionFieldSpecs, context),
    ];

    return { groups: groups.filter((group) => group.fields.length) };
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
      ...super.toJSON(),
    };
  }
}

module.exports = { ItemCollectionEntity };
