const { BaseStorage } = require("./baseStorage");
const { ItemEntity } = require("../entities/itemEntity");
const { updateQuery } = require("../services/queryService");

class ItemStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "items";
  static Entity = ItemEntity;

  async listEntities() {
    const query = await this.buildSelect();
    const t = this.tableAlias;

    query
      .whereColumn(t, "instance_guid", this.instanceGuid)
      .orderBy(t, "name", "ASC", "NULLS LAST")
      .orderBy(t, "create_datetime");

    const result = await this.query(query.toString(), query.params);
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
  }

  async save(entity) {
    const { guid, instanceGuid, itemTemplateGuid, name, description, weight } = entity;
    if (entity.isNew) {
      await this.query(
        `
          INSERT INTO ${this.schema_table} (
            guid,
            instance_guid,
            item_template_guid,
            name,
            description,
            weight
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [guid, instanceGuid, itemTemplateGuid, name, description, weight],
      );
      entity.isNew = false;
    } else {
      const { schema, table } = this.constructor;
      const t = this.tableAlias;
      const query = updateQuery()
        .from(schema, table, t)
        .set(["item_template_guid", "name", "description", "weight"], [itemTemplateGuid, name, description, weight])
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
        itemTemplateGuid: reloaded.itemTemplateGuid,
        name: reloaded.name,
        description: reloaded.description,
        weight: reloaded.weight,
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
      itemTemplateGuid: row.item_template_guid,
      name: row.name,
      description: row.description,
      weight: row.weight,
      createDatetime: row.create_datetime,
      updateDatetime: row.update_datetime,
      ...extensionValues,
    });
  }
}

module.exports = ItemStorage;
