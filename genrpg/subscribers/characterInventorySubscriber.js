const crypto = require("node:crypto");
const { pool } = require("../../src/db/pool");
const { getTransactionClient } = require("../../src/db/transactionContext");

const INVENTORY_COLLECTION_TYPE = "inventory";

class CharacterInventorySubscriber {
  query(text, params) {
    const client = getTransactionClient();
    if (client) {
      return client.query(text, params);
    }
    return pool.query(text, params);
  }

  async onCharacterPostCreate(event) {
    const { instanceGuid, entity } = event;
    const characterGuid = entity.guid;
    if (!instanceGuid || !characterGuid) {
      throw new Error("Character inventory subscriber: missing instance or character guid");
    }

    const existing = await this.query(
      `
        SELECT i.guid
        FROM genrpg.inventories i
        JOIN genrpg.item_collections c ON c.guid = i.collection_guid
        WHERE i.character_guid = $1
          AND i.instance_guid = $2
          AND c.type = $3
        LIMIT 1
      `,
      [characterGuid, instanceGuid, INVENTORY_COLLECTION_TYPE],
    );
    if (existing.rows.length) {
      return;
    }

    const collectionGuid = crypto.randomUUID();
    const inventoryGuid = crypto.randomUUID();

    await this.query(
      `
        INSERT INTO genrpg.item_collections (
          guid,
          instance_guid,
          type,
          name
        )
        VALUES ($1, $2, $3, NULL)
      `,
      [collectionGuid, instanceGuid, INVENTORY_COLLECTION_TYPE],
    );
    await this.query(
      `
        INSERT INTO genrpg.inventories (
          guid,
          instance_guid,
          collection_guid,
          character_guid
        )
        VALUES ($1, $2, $3, $4)
      `,
      [inventoryGuid, instanceGuid, collectionGuid, characterGuid],
    );
  }
}

module.exports = CharacterInventorySubscriber;
