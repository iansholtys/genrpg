const { BaseEntity } = require("../../src/entities/baseEntity");

class PackageEntity extends BaseEntity {
  static key = "package";
  static labelProperties = ["machineName"];

  static getStorage() {
    return require("../../src/storage/packageStorage");
  }
}

module.exports = PackageEntity;
