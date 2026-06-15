const { BaseStorage } = require("../../src/storage/baseStorage");
const CharacterEntity = require("../entities/character");

class CharacterStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "characters";
  static Entity = CharacterEntity;

  async listEntities({ orderBy = [], ...filters } = {}) {
    const args = { ...filters };
    args.orderBy = orderBy.length ? orderBy : [
      { property: "displayName", nulls: "LAST" },
      { property: "createDatetime" },
    ];
    return super.listEntities(args);
  }
}

module.exports = CharacterStorage;
