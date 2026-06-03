const { BaseStorage } = require("./baseStorage");
const { ItemCollectionEntity } = require("../entities/itemCollectionEntity");
const { ItemCollectionContentEntity } = require("../entities/itemCollectionContentEntity");

const COLLECTION_COLUMNS = `
  guid,
  instance_guid,
  type,
  name,
  item_guid,
  capacity_used,
  capacity_max,
  create_datetime,
  update_datetime
`;

const CONTENT_COLUMNS = `
  guid,
  instance_guid,
  collection_guid,
  item_guid,
  subcollection_guid,
  quantity,
  position,
  create_datetime,
  update_datetime
`;

/**
 * Storage for item collections and their contents.
 */
class ItemCollectionStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "item_collections";
  static contentSchema = "genrpg";
  static contentTable = "item_collection_contents";

  static get contentSchemaTable() {
    return `${this.contentSchema}.${this.contentTable}`;
  }

  get contentSchemaTable() {
    return this.constructor.contentSchemaTable;
  }

  createCollection() {
    return new ItemCollectionEntity({
      instanceGuid: this.instanceGuid,
      guid: this.newGuid(),
      isNew: true,
      storage: this,
    });
  }

  createContent(collectionGuid) {
    return new ItemCollectionContentEntity({
      instanceGuid: this.instanceGuid,
      guid: this.newGuid(),
      isNew: true,
      storage: this,
      collectionGuid,
    });
  }

  async loadCollection(collectionGuid) {
    const result = await this.query(
      `
        SELECT ${COLLECTION_COLUMNS}
        FROM ${this.schema_table}
        WHERE guid = $1 AND instance_guid = $2
      `,
      [collectionGuid, this.instanceGuid],
    );
    return result.rows[0] ? this.toCollectionEntity(result.rows[0]) : null;
  }

  async loadContent(collectionGuid, contentGuid) {
    const result = await this.query(
      `
        SELECT ${CONTENT_COLUMNS}
        FROM ${this.contentSchemaTable}
        WHERE guid = $1
          AND collection_guid = $2
          AND instance_guid = $3
      `,
      [contentGuid, collectionGuid, this.instanceGuid],
    );
    return result.rows[0] ? this.toContentEntity(result.rows[0]) : null;
  }

  async listCollections({ itemGuid, type } = {}) {
    const params = [this.instanceGuid];
    const conditions = ["instance_guid = $1"];

    if (itemGuid) {
      params.push(itemGuid);
      conditions.push(`item_guid = $${params.length}`);
    }

    if (type) {
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }

    const result = await this.query(
      `
        SELECT ${COLLECTION_COLUMNS}
        FROM ${this.schema_table}
        WHERE ${conditions.join(" AND ")}
        ORDER BY type ASC, COALESCE(name, '') ASC, create_datetime ASC
      `,
      params,
    );
    return result.rows.map((row) => this.toCollectionEntity(row));
  }

  async saveCollection(entity) {
    if (entity.isNew) {
      await this.query(
        `
          INSERT INTO ${this.schema_table} (
            guid,
            instance_guid,
            type,
            name,
            item_guid,
            capacity_used,
            capacity_max
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          entity.guid,
          entity.instanceGuid,
          entity.type,
          entity.name,
          entity.itemGuid,
          entity.capacityUsed,
          entity.capacityMax,
        ],
      );
      entity.isNew = false;
    } else {
      const result = await this.query(
        `
          UPDATE ${this.schema_table}
          SET
            type = $1,
            name = $2,
            item_guid = $3,
            capacity_used = $4,
            capacity_max = $5
          WHERE guid = $6 AND instance_guid = $7
          RETURNING guid
        `,
        [
          entity.type,
          entity.name,
          entity.itemGuid,
          entity.capacityUsed,
          entity.capacityMax,
          entity.guid,
          entity.instanceGuid,
        ],
      );
      if (!result.rows.length) {
        return null;
      }
    }

    const reloaded = await this.loadCollection(entity.guid);
    if (reloaded) {
      Object.assign(entity, {
        type: reloaded.type,
        name: reloaded.name,
        itemGuid: reloaded.itemGuid,
        capacityUsed: reloaded.capacityUsed,
        capacityMax: reloaded.capacityMax,
        createDatetime: reloaded.createDatetime,
        updateDatetime: reloaded.updateDatetime,
      });
    }
    return entity;
  }

  async deleteCollection(collectionGuid) {
    return this.delete(collectionGuid);
  }

  async listContents(collectionGuid) {
    const result = await this.query(
      `
        SELECT ${CONTENT_COLUMNS}
        FROM ${this.contentSchemaTable}
        WHERE collection_guid = $1 AND instance_guid = $2
        ORDER BY position ASC, create_datetime ASC
      `,
      [collectionGuid, this.instanceGuid],
    );
    return result.rows.map((row) => this.toContentEntity(row));
  }

  async saveContent(entity) {
    if (entity.isNew) {
      await this.query(
        `
          INSERT INTO ${this.contentSchemaTable} (
            guid,
            instance_guid,
            collection_guid,
            item_guid,
            subcollection_guid,
            quantity,
            position
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          entity.guid,
          entity.instanceGuid,
          entity.collectionGuid,
          entity.itemGuid,
          entity.subcollectionGuid,
          entity.quantity,
          entity.position,
        ],
      );
      entity.isNew = false;
    } else {
      await this.query(
        `
          UPDATE ${this.contentSchemaTable}
          SET
            item_guid = $1,
            subcollection_guid = $2,
            quantity = $3,
            position = $4
          WHERE guid = $5
            AND collection_guid = $6
            AND instance_guid = $7
        `,
        [
          entity.itemGuid,
          entity.subcollectionGuid,
          entity.quantity,
          entity.position,
          entity.guid,
          entity.collectionGuid,
          entity.instanceGuid,
        ],
      );
    }

    const reloaded = await this.loadContent(entity.collectionGuid, entity.guid);
    if (reloaded) {
      Object.assign(entity, {
        itemGuid: reloaded.itemGuid,
        subcollectionGuid: reloaded.subcollectionGuid,
        quantity: reloaded.quantity,
        position: reloaded.position,
        createDatetime: reloaded.createDatetime,
        updateDatetime: reloaded.updateDatetime,
      });
    }
    return entity;
  }

  async deleteContent(collectionGuid, contentGuid) {
    const result = await this.query(
      `
        DELETE FROM ${this.contentSchemaTable}
        WHERE guid = $1
          AND collection_guid = $2
          AND instance_guid = $3
        RETURNING guid
      `,
      [contentGuid, collectionGuid, this.instanceGuid],
    );
    return result.rows.length > 0;
  }

  toCollectionEntity(row) {
    return new ItemCollectionEntity({
      instanceGuid: row.instance_guid,
      guid: row.guid,
      isNew: false,
      storage: this,
      type: row.type,
      name: row.name,
      itemGuid: row.item_guid,
      capacityUsed: row.capacity_used,
      capacityMax: row.capacity_max,
      createDatetime: row.create_datetime,
      updateDatetime: row.update_datetime,
    });
  }

  toContentEntity(row) {
    return new ItemCollectionContentEntity({
      instanceGuid: row.instance_guid,
      guid: row.guid,
      isNew: false,
      storage: this,
      collectionGuid: row.collection_guid,
      itemGuid: row.item_guid,
      subcollectionGuid: row.subcollection_guid,
      quantity: row.quantity,
      position: row.position,
      createDatetime: row.create_datetime,
      updateDatetime: row.update_datetime,
    });
  }
}

module.exports = ItemCollectionStorage;
