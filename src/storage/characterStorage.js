const { BaseStorage } = require("./baseStorage");

class CharacterStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "characters";

  static get Entity() {
    return require("../entities/characterEntity").CharacterEntity;
  }

  async listEntities(options = {}) {
    return super.listEntities({
      ...options,
      orderBy: [{ field: "display_name", nulls: "LAST" }, { field: "create_datetime" }],
    });
  }
}

module.exports = CharacterStorage;
