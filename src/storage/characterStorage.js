const { BaseStorage } = require("./baseStorage");

class CharacterStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "characters";

  static get Entity() {
    return require("../entities/characterEntity").CharacterEntity;
  }

  async listEntities() {
    const query = await this.buildSelect();
    const t = this.tableAlias;

    query
      .whereColumn(t, "instance_guid", this.instanceGuid)
      .orderBy(t, "display_name", "ASC", "NULLS LAST")
      .orderBy(t, "create_datetime");

    const result = await this.query(query.toString(), query.params);
    return Promise.all(result.rows.map((row) => this.toEntity(row)));
  }
}

module.exports = CharacterStorage;
