const { BaseStorage } = require("./baseStorage");
const { InventoryEntity } = require("../entities/inventoryEntity");

const INVENTORY_COLUMNS = `
  guid,
  instance_guid,
  collection_guid,
  character_guid,
  create_datetime,
  update_datetime
`;

/**
 * Storage for character inventories (links a collection to a character).
 */
class InventoryStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "inventories";

  create() {
    return new InventoryEntity({
      instanceGuid: this.instanceGuid,
      guid: this.newGuid(),
      isNew: true,
      storage: this,
    });
  }

  async load(inventoryGuid) {
    const result = await this.query(
      `
        SELECT ${INVENTORY_COLUMNS}
        FROM ${this.schema_table}
        WHERE guid = $1 AND instance_guid = $2
      `,
      [inventoryGuid, this.instanceGuid],
    );
    return result.rows[0] ? this.toEntity(result.rows[0]) : null;
  }

  async list({ characterGuid, collectionGuid } = {}) {
    const params = [this.instanceGuid];
    const conditions = ["instance_guid = $1"];

    if (characterGuid) {
      params.push(characterGuid);
      conditions.push(`character_guid = $${params.length}`);
    }

    if (collectionGuid) {
      params.push(collectionGuid);
      conditions.push(`collection_guid = $${params.length}`);
    }

    const result = await this.query(
      `
        SELECT ${INVENTORY_COLUMNS}
        FROM ${this.schema_table}
        WHERE ${conditions.join(" AND ")}
        ORDER BY create_datetime ASC
      `,
      params,
    );
    return result.rows.map((row) => this.toEntity(row));
  }

  async save(entity) {
    if (entity.isNew) {
      await this.query(
        `
          INSERT INTO ${this.schema_table} (
            guid,
            instance_guid,
            collection_guid,
            character_guid
          )
          VALUES ($1, $2, $3, $4)
        `,
        [entity.guid, entity.instanceGuid, entity.collectionGuid, entity.characterGuid],
      );
      entity.isNew = false;
    } else {
      const result = await this.query(
        `
          UPDATE ${this.schema_table}
          SET collection_guid = $1, character_guid = $2
          WHERE guid = $3 AND instance_guid = $4
          RETURNING guid
        `,
        [entity.collectionGuid, entity.characterGuid, entity.guid, entity.instanceGuid],
      );
      if (!result.rows.length) {
        return null;
      }
    }

    const reloaded = await this.load(entity.guid);
    if (reloaded) {
      Object.assign(entity, {
        collectionGuid: reloaded.collectionGuid,
        characterGuid: reloaded.characterGuid,
        createDatetime: reloaded.createDatetime,
        updateDatetime: reloaded.updateDatetime,
      });
    }
    return entity;
  }

  toEntity(row) {
    return new InventoryEntity({
      instanceGuid: row.instance_guid,
      guid: row.guid,
      isNew: false,
      storage: this,
      collectionGuid: row.collection_guid,
      characterGuid: row.character_guid,
      createDatetime: row.create_datetime,
      updateDatetime: row.update_datetime,
    });
  }
}

module.exports = InventoryStorage;
