const { BaseStorage } = require("./baseStorage");
const { ItemEntity } = require("../entities/itemEntity");
const ItemTemplateStorage = require("./itemTemplateStorage");

class ItemStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "items";

  create() {
    return new ItemEntity({
      instanceGuid: this.instanceGuid,
      guid: this.newGuid(),
      isNew: true,
      storage: this,
    });
  }

  async list() {
    const result = await this.query(
      `
        ${this.buildItemSelect()}
        WHERE i.instance_guid = $1
        ORDER BY COALESCE(i.name, t.name) ASC, i.create_datetime ASC
      `,
      [this.instanceGuid],
    );
    return result.rows.map((row) => this.toEntity(row));
  }

  async load(itemGuid) {
    const result = await this.query(
      `
        ${this.buildItemSelect()}
        WHERE i.guid = $1 AND i.instance_guid = $2
      `,
      [itemGuid, this.instanceGuid],
    );
    return result.rows[0] ? this.toEntity(result.rows[0]) : null;
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

    const reloaded = await this.load(entity.guid);
    if (reloaded) {
      Object.assign(entity, {
        itemTemplateGuid: reloaded.itemTemplateGuid,
        name: reloaded.name,
        description: reloaded.description,
        weight: reloaded.weight,
        createDatetime: reloaded.createDatetime,
        updateDatetime: reloaded.updateDatetime,
        itemTemplate: reloaded.itemTemplate,
        effectiveName: reloaded.effectiveName,
        effectiveDescription: reloaded.effectiveDescription,
        effectiveWeight: reloaded.effectiveWeight,
      });
    }
    return entity;
  }

  toEntity(row) {
    const itemTemplate = {
      guid: row.template_guid,
      name: row.template_name,
      description: row.template_description,
      weight: row.template_weight,
    };
    const effectiveName = row.name ?? row.template_name;
    const effectiveDescription = row.description ?? row.template_description;
    const effectiveWeight =
      row.weight !== null && row.weight !== undefined ? row.weight : row.template_weight;

    return new ItemEntity({
      instanceGuid: row.instance_guid,
      guid: row.guid,
      isNew: false,
      storage: this,
      itemTemplateGuid: row.item_template_guid,
      name: row.name,
      description: row.description,
      weight: row.weight,
      createDatetime: row.create_datetime,
      updateDatetime: row.update_datetime,
      itemTemplate,
      effectiveName,
      effectiveDescription,
      effectiveWeight,
    });
  }

  buildItemSelect() {
    return `
      SELECT
        i.guid,
        i.instance_guid,
        i.item_template_guid,
        i.name,
        i.description,
        i.weight,
        i.create_datetime,
        i.update_datetime,
        t.guid AS template_guid,
        t.name AS template_name,
        t.description AS template_description,
        t.weight AS template_weight
      FROM ${this.schema_table} i
      JOIN ${ItemTemplateStorage.schema_table} t ON t.guid = i.item_template_guid
    `;
  }
}

module.exports = ItemStorage;
