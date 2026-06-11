const { BaseStorage } = require("./baseStorage");
const { ItemCollectionEntity } = require("../entities/itemCollectionEntity");
const { insertQuery, qualify, updateQuery } = require("../services/queryService");

/**
 * Storage for item collections.
 */
class ItemCollectionStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "item_collections";
  static Entity = ItemCollectionEntity;

  async listEntities({ itemGuid, type } = {}) {
    const query = await this.buildSelect();
    const t = this.tableAlias;

    query.whereColumn(t, "instance_guid", this.instanceGuid);

    if (itemGuid) {
      query.whereColumn(t, "item_guid", itemGuid);
    }

    if (type) {
      query.whereColumn(t, "type", type);
    }

    query
      .orderBy(t, "type")
      .orderBy(null, `COALESCE(${qualify(t, "name")}, '')`)
      .orderBy(t, "create_datetime");

    const result = await this.query(query.toString(), query.params);
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
  }

  async save(entity) {
    const { guid, instanceGuid, type, name, itemGuid, capacityUsed, capacityMax } = entity;
    if (entity.isNew) {
      const { schema, table } = this.constructor;
      const insert = insertQuery()
        .into(schema, table)
        .values(
          ["guid", "instance_guid", "type", "name", "item_guid", "capacity_used", "capacity_max"],
          [guid, instanceGuid, type, name, itemGuid, capacityUsed, capacityMax],
        );

      await this.query(insert.toString(), insert.params);
      entity.isNew = false;
    } else {
      const { schema, table } = this.constructor;
      const t = this.tableAlias;
      const query = updateQuery()
        .from(schema, table, t)
        .set(["type", "name", "item_guid", "capacity_used", "capacity_max"],
          [type, name, itemGuid, capacityUsed, capacityMax])
        .whereColumn(t, "guid", guid)
        .whereColumn(t, "instance_guid", this.instanceGuid)
        .returning(t, "guid");

      const result = await this.query(query.toString(), query.params);
      if (!result.rows.length) {
        return null;
      }
    }

    await this.saveExtensionRowsForEntity(entity);

    const reloaded = await this.load(guid);
    if (reloaded) {
      Object.assign(entity, {
        type: reloaded.type,
        name: reloaded.name,
        itemGuid: reloaded.itemGuid,
        capacityUsed: reloaded.capacityUsed,
        capacityMax: reloaded.capacityMax,
        createDatetime: reloaded.createDatetime,
        updateDatetime: reloaded.updateDatetime,
        packageData: reloaded.packageData,
      });
      this.assignExtensionFieldsFromReload(entity, reloaded);
    }
    return entity;
  }

  async toEntity(row) {
    const { extensionFieldSpecs, packageData, extensionValues } = await this.extensionContextFromRow(row);

    return new this.constructor.Entity({
      instanceGuid: row.instance_guid,
      guid: row.guid,
      isNew: false,
      storage: this,
      extensionFieldSpecs,
      packageData,
      type: row.type,
      name: row.name,
      itemGuid: row.item_guid,
      capacityUsed: row.capacity_used,
      capacityMax: row.capacity_max,
      createDatetime: row.create_datetime,
      updateDatetime: row.update_datetime,
      ...extensionValues,
    });
  }
}

module.exports = ItemCollectionStorage;
