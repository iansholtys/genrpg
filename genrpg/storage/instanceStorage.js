const { BaseStorage } = require("../../src/storage/baseStorage");
const InstanceEntity = require("../entities/instance");

class InstanceStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "instances";
  static Entity = InstanceEntity;

  static get instanceScoped() {
    return false;
  }

  async listEntities({ orderBy = [], ...filters } = {}) {
    const args = { ...filters };
    args.orderBy = orderBy.length ? orderBy : [{ property: "name" }];
    return super.listEntities(args);
  }
}

module.exports = InstanceStorage;
