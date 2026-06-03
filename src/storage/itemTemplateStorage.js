const { BaseStorage } = require("./baseStorage");
const { ItemTemplateEntity } = require("../entities/itemTemplateEntity");

const RETURNING_COLUMNS = `
  guid,
  instance_guid,
  name,
  description,
  weight,
  create_datetime,
  update_datetime
`;

class ItemTemplateStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "item_templates";

  create() {
    return new ItemTemplateEntity({
      instanceGuid: this.instanceGuid,
      guid: this.newGuid(),
      isNew: true,
      storage: this,
    });
  }

  async list() {
    const result = await this.query(
      `
        SELECT ${RETURNING_COLUMNS}
        FROM ${this.schema_table}
        WHERE instance_guid = $1
        ORDER BY name ASC, create_datetime ASC
      `,
      [this.instanceGuid],
    );
    return result.rows.map((row) => this.toEntity(row));
  }

  async load(templateGuid) {
    const result = await this.query(
      `
        SELECT ${RETURNING_COLUMNS}
        FROM ${this.schema_table}
        WHERE guid = $1 AND instance_guid = $2
      `,
      [templateGuid, this.instanceGuid],
    );
    return result.rows[0] ? this.toEntity(result.rows[0]) : null;
  }

  async save(entity) {
    if (entity.isNew) {
      const result = await this.query(
        `
          INSERT INTO ${this.schema_table} (guid, instance_guid, name, description, weight)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING ${RETURNING_COLUMNS}
        `,
        [entity.guid, entity.instanceGuid, entity.name, entity.description, entity.weight],
      );
      const saved = this.toEntity(result.rows[0]);
      entity.isNew = false;
      Object.assign(entity, {
        name: saved.name,
        description: saved.description,
        weight: saved.weight,
        createDatetime: saved.createDatetime,
        updateDatetime: saved.updateDatetime,
      });
      return entity;
    }

    const result = await this.query(
      `
        UPDATE ${this.schema_table}
        SET name = $1, description = $2, weight = $3
        WHERE guid = $4 AND instance_guid = $5
        RETURNING ${RETURNING_COLUMNS}
      `,
      [entity.name, entity.description, entity.weight, entity.guid, entity.instanceGuid],
    );
    if (!result.rows.length) {
      return null;
    }
    const saved = this.toEntity(result.rows[0]);
    Object.assign(entity, {
      name: saved.name,
      description: saved.description,
      weight: saved.weight,
      createDatetime: saved.createDatetime,
      updateDatetime: saved.updateDatetime,
    });
    return entity;
  }

  toEntity(row) {
    return new ItemTemplateEntity({
      instanceGuid: row.instance_guid,
      guid: row.guid,
      isNew: false,
      storage: this,
      name: row.name,
      description: row.description,
      weight: row.weight,
      createDatetime: row.create_datetime,
      updateDatetime: row.update_datetime,
    });
  }
}

module.exports = ItemTemplateStorage;
