const { mergeExtensionFieldSpecs } = require("../lib/entityExtensionIndex");
const { BaseEntity } = require("./baseEntity");
const { ItemEntity } = require("./itemEntity");
const { ItemCollectionEntity } = require("./itemCollectionEntity");

class ItemCollectionContentEntity extends BaseEntity {
  static key = "item_collection_content";

  static getStorage() {
    return require("../storage/itemCollectionContentStorage");
  }

  static fields = {
    itemGuid: { label: "Item", type: "guid", refs: ItemEntity },
    subcollectionGuid: { label: "Subcollection", type: "guid", refs: ItemCollectionEntity },
    quantity: { label: "Quantity", type: "integer", required: true, default: 1 },
    position: { label: "Position", type: "integer", required: true, default: 0 },
    collectionGuid: { readOnly: true },
    createDatetime: { readOnly: true },
    updateDatetime: { readOnly: true },
    packageData: { readOnly: true, virtual: true, default: {} },
  };

  constructor(options = {}) {
    super(options);
    this.initFields(options);
  }

  static async getFormSchema(context, { collectionGuid } = {}) {
    const ItemStorage = require("../storage/itemStorage");
    const ItemCollectionStorage = require("../storage/itemCollectionStorage");

    const packageNames = Object.keys(context.instance.packages);
    const extensionFieldSpecs = mergeExtensionFieldSpecs(
      ItemCollectionContentEntity.key,
      packageNames,
      Object.keys(ItemCollectionContentEntity.fields),
    );
    const [items, collections] = await Promise.all([
      ItemStorage.forInstance(context.instance).list(),
      ItemCollectionStorage.forInstance(context.instance).list(),
    ]);

    const coreFields = Object.entries(ItemCollectionContentEntity.fields)
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
        if (key === "subcollectionGuid") {
          return this.formFieldFromSpec(key, spec, {
            inputType: "select",
            options: collections
              .filter((collection) => collection.guid !== collectionGuid)
              .map((collection) => ({
                value: collection.guid,
                label: collection.name || collection.type || collection.guid,
              })),
          });
        }
        return this.formFieldFromSpec(key, spec);
      });

    const groups = [
      { id: "core", label: "Collection Content", fields: coreFields },
      ...this.buildExtensionFormGroups(extensionFieldSpecs, context),
    ];

    return { groups: groups.filter((group) => group.fields.length) };
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
      ...super.toJSON(),
    };
  }
}

module.exports = { ItemCollectionContentEntity };
