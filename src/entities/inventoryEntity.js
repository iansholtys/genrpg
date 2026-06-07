const { BaseEntity } = require("./baseEntity");
const { ItemCollectionEntity } = require("./itemCollectionEntity");
const { CharacterEntity } = require("./characterEntity");
const { mergeExtensionFieldSpecs } = require("../lib/entityExtensionIndex");
const CharacterStorage = require("../storage/characterStorage");

class InventoryEntity extends BaseEntity {
  static key = "inventory";

  static getStorage() {
    return require("../storage/inventoryStorage");
  }

  static fields = {
    collectionGuid: {
      label: "Collection",
      type: "guid",
      required: true,
      refs: ItemCollectionEntity,
    },
    characterGuid: {
      label: "Character",
      type: "guid",
      required: true,
      refs: CharacterEntity,
    },
    createDatetime: { readOnly: true },
    updateDatetime: { readOnly: true },
    packageData: { readOnly: true, virtual: true, default: {} },
  };

  constructor(options = {}) {
    super(options);
    this.initFields(options);
  }

  static async getFormSchema(context) {
    const ItemCollectionStorage = require("../storage/itemCollectionStorage");

    const packageNames = Object.keys(context.instance.packages);
    const extensionFieldSpecs = mergeExtensionFieldSpecs(
      InventoryEntity.key,
      packageNames,
      Object.keys(InventoryEntity.fields),
    );
    const [collections, characters] = await Promise.all([
      ItemCollectionStorage.forInstance(context.instance).listCollections(),
      CharacterStorage.forInstance(context.instance).list(),
    ]);
    const coreFields = Object.entries(InventoryEntity.fields)
      .filter(([, spec]) => !spec.readOnly)
      .map(([key, spec]) => {
      if (key === "collectionGuid") {
        return this.formFieldFromSpec(key, spec, {
          inputType: "select",
          options: collections.map((collection) => ({
            value: collection.guid,
            label: collection.name || collection.type || collection.guid,
          })),
        });
      }
      if (key === "characterGuid") {
        return this.formFieldFromSpec(key, spec, {
          inputType: "select",
          options: characters.map((character) => ({
            value: character.guid,
            label: character.displayName || character.fullName || character.guid,
          })),
        });
      }
      return this.formFieldFromSpec(key, spec);
    });

    const groups = [
      { id: "core", label: "Inventory", fields: coreFields },
      ...this.buildExtensionFormGroups(extensionFieldSpecs, context),
    ];

    return { groups: groups.filter((group) => group.fields.length) };
  }

  toJSON() {
    return {
      guid: this.guid,
      instanceGuid: this.instanceGuid,
      collectionGuid: this.collectionGuid,
      characterGuid: this.characterGuid,
      createDatetime: this.createDatetime,
      updateDatetime: this.updateDatetime,
      ...super.toJSON(),
    };
  }
}

module.exports = { InventoryEntity };
