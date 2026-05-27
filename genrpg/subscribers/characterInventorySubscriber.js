const crypto = require("node:crypto");

const INVENTORY_COLLECTION_TYPE = "inventory";

class CharacterInventorySubscriber {
  async onCharacterPostCreate(event) {
    const { pool, instanceGuid, characterGuid } = event;
    if (!pool || !instanceGuid || !characterGuid) {
      throw new Error("Character inventory subscriber: missing pool, instance, or character guid");
    }

    const existing = await pool.query(
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
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
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
      await client.query(
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
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = CharacterInventorySubscriber;
