const { ValidationError } = require("../../src/errors/ValidationError");
const ItemCollectionStorage = require("../storage/itemCollectionStorage");

const INVENTORY_COLLECTION_TYPE = "inventory";

class CharacterInventorySubscriber {
  async onCharacterPostCreate(event) {
    const { instance, entity } = event;
    if (!instance?.guid || !entity?.guid) {
      throw new Error("Character inventory subscriber: missing instance or character guid");
    }

    const inventories = Array.isArray(entity.inventories) ? entity.inventories : [];
    if (inventories.some((entry) => entry?.type === INVENTORY_COLLECTION_TYPE)) {
      return;
    }

    const collectionStorage = ItemCollectionStorage.forInstance(instance);
    const collection = await collectionStorage.create();
    collection.set({ type: INVENTORY_COLLECTION_TYPE, name: null });
    await collection.validate();
    await collection.save();

    entity.set({
      inventories: [
        ...inventories,
        {
          collectionGuid: collection.guid,
          name: null,
          type: INVENTORY_COLLECTION_TYPE,
        },
      ],
    });

    const validationErrors = await entity.validate();
    if (validationErrors.length) {
      throw new ValidationError(validationErrors);
    }

    await entity.save({ skipEvents: true });
  }
}

module.exports = CharacterInventorySubscriber;
