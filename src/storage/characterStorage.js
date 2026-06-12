const { BaseStorage } = require("./baseStorage");
const { CharacterEntity } = require("../entities/characterEntity");

class CharacterStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "characters";
  static Entity = CharacterEntity;

  async listEntities(options = {}) {
    return super.listEntities({
      ...options,
      orderBy: [{ field: "display_name", nulls: "LAST" }, { field: "create_datetime" }],
    });
  }
}

module.exports = CharacterStorage;
