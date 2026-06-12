const { BaseEntity } = require("./baseEntity");
const { ItemCollectionEntity } = require("./itemCollectionEntity");
const { CharacterEntity } = require("./characterEntity");

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
    const CharacterStorage = require("../storage/characterStorage");

    const extensionFieldSpecs = await this.getStorage().forInstance(context.instance).getExtensionFieldSpecs();
    const [collections, characters] = await Promise.all([
      ItemCollectionStorage.forInstance(context.instance).list(),
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
}

module.exports = { InventoryEntity };
