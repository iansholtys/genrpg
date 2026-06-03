const { BaseEntity } = require("./baseEntity");
const { ItemCollectionEntity } = require("./itemCollectionEntity");
const { CharacterEntity } = require("./characterEntity");

class InventoryEntity extends BaseEntity {
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
  };

  static readOnlyFields = ["createDatetime", "updateDatetime"];

  constructor(options = {}) {
    super(options);
    this.initFields(options);
  }

  toJSON() {
    return {
      guid: this.guid,
      instanceGuid: this.instanceGuid,
      collectionGuid: this.collectionGuid,
      characterGuid: this.characterGuid,
      createDatetime: this.createDatetime,
      updateDatetime: this.updateDatetime,
    };
  }
}

module.exports = { InventoryEntity };
