const { BaseStorage } = require("./baseStorage");
const { ItemTemplateEntity } = require("../entities/itemTemplateEntity");

class ItemTemplateStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "item_templates";
  static Entity = ItemTemplateEntity;

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
    if (entity.isNew) {
      await this.query(
        `
          INSERT INTO ${this.schema_table} (
            guid,
            instance_guid,
            name,
            description,
            weight
          )
          VALUES ($1, $2, $3, $4, $5)
        `,
        [entity.guid, entity.instanceGuid, entity.name, entity.description, entity.weight],
      );
      entity.isNew = false;
    } else {
      const result = await this.query(
        `
          UPDATE ${this.schema_table}
          SET name = $1, description = $2, weight = $3
          WHERE guid = $4 AND instance_guid = $5
          RETURNING guid
        `,
        [entity.name, entity.description, entity.weight, entity.guid, entity.instanceGuid],
      );
      if (!result.rows.length) {
        return null;
      }
    }

    await this.saveExtensionRowsForEntity(entity);

    const reloaded = await this.load(entity.guid);
    if (reloaded) {
      Object.assign(entity, {
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
      name: row.name,
      description: row.description,
      weight: row.weight,
      createDatetime: row.create_datetime,
      updateDatetime: row.update_datetime,
      ...extensionValues,
    });
  }
}

module.exports = ItemTemplateStorage;
