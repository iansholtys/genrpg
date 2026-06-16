const { BaseStorage } = require("./baseStorage");
const PackageEntity = require("../../genrpg/entities/package");

class PackageStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "packages";
  static Entity = PackageEntity;

  static get instanceScoped() {
    return false;
  }

  async listEntities({ orderBy = [], ...filters } = {}) {
    const args = { ...filters };
    args.orderBy = orderBy.length ? orderBy : [{ property: "machineName" }];
    return super.listEntities(args);
  }
}

module.exports = PackageStorage;
