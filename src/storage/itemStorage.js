const { BaseStorage } = require("./baseStorage");
const { ItemEntity } = require("../entities/itemEntity");

class ItemStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "items";
  static Entity = ItemEntity;

  async listEntities() {
    const query = await this.buildSelect();
    const t = this.tableAlias;

    query.where(`${t}.instance_guid = $1`, [this.instanceGuid]);

    const result = await this.query(
      `${query.toString()}
        ORDER BY ${t}.name ASC NULLS LAST, ${t}.create_datetime ASC
      `,
      query.params,
    );
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
  }

  async loadEntity(itemGuids) {
    const query = await this.buildSelect();
    const t = this.tableAlias;

    query
      .where(`${t}.guid = ANY($1)`, [itemGuids])
      .where(`${t}.instance_guid = $1`, [this.instanceGuid]);

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
            item_template_guid,
            name,
            description,
            weight
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          entity.guid,
          entity.instanceGuid,
          entity.itemTemplateGuid,
          entity.name,
          entity.description,
          entity.weight,
        ],
      );
      entity.isNew = false;
    } else {
      const result = await this.query(
        `
          UPDATE ${this.schema_table}
          SET
            item_template_guid = $1,
            name = $2,
            description = $3,
            weight = $4
          WHERE guid = $5 AND instance_guid = $6
          RETURNING guid
        `,
        [
          entity.itemTemplateGuid,
          entity.name,
          entity.description,
          entity.weight,
          entity.guid,
          entity.instanceGuid,
        ],
      );
      if (!result.rows.length) {
        return null;
      }
    }

    await this.saveExtensionRowsForEntity(entity);

    const reloaded = await this.load(entity.guid);
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
      packageNames: this.packageNames,
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
