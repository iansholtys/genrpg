const InventoryStorage = require("../../src/storage/inventoryStorage");
const ItemCollectionStorage = require("../../src/storage/itemCollectionStorage");
const { select } = require("../../src/services/queryService");

const INVENTORY_COLLECTION_TYPE = "inventory";

class CharacterInventorySubscriber {
  async onCharacterPostCreate(event) {
    const { instance, entity } = event;
    const characterGuid = entity.guid;
    if (!instance?.guid || !characterGuid) {
      throw new Error("Character inventory subscriber: missing instance or character guid");
    }

    const inventoryStorage = InventoryStorage.forInstance(instance);

    const existingQuery = select()
      .from("genrpg", "inventories", "i")
      .addFields("i", ["guid"])
      .addJoin("genrpg", "item_collections", "c", "c.guid = i.collection_guid")
      .where("i.character_guid = $1", [characterGuid])
      .where("i.instance_guid = $1", [instance.guid])
      .where("c.type = $1", [INVENTORY_COLLECTION_TYPE]);

    const existing = await inventoryStorage.query(
      `${existingQuery.toString()} LIMIT 1`,
      existingQuery.params,
    );
    if (existing.rows.length) {
      return;
    }

    const collectionStorage = ItemCollectionStorage.forInstance(instance);
    const collection = await collectionStorage.create();
    collection.set({ type: INVENTORY_COLLECTION_TYPE, name: null });
    await collection.validate();
    await collection.save();

    const inventory = await inventoryStorage.create();
    inventory.set({ collectionGuid: collection.guid, characterGuid });
    await inventory.validate();
    await inventory.save();
  }
}

module.exports = CharacterInventorySubscriber;
