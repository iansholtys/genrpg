const { BaseStorage } = require("./baseStorage");
const PermissionEntity = require("../../genrpg/entities/permission");

class PermissionStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "permissions";
  static Entity = PermissionEntity;

  static get instanceScoped() {
    return false;
  }

  async listEntities({ orderBy = [], ...filters } = {}) {
    const args = { ...filters };
    args.orderBy = orderBy.length ? orderBy : [{ property: "name" }];
    return super.listEntities(args);
  }
}

module.exports = PermissionStorage;
