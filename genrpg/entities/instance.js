const { BaseEntity } = require("../../src/entities/baseEntity");
const {
  validatePackageInstallSelection,
} = require("../../src/packages");

class InstanceEntity extends BaseEntity {
  static key = "instance";
  static labelProperties = ["name"];

  static getStorage() {
    return require("../storage/instanceStorage");
  }

  /**
   * Machine names for packages installed on this instance.
   * Unlike other entities, this is owned by the instance (from its `packages` field),
   * not delegated from {@link InstanceStorage}.
   */
  get packageNames() {
    return this._packageNames ?? [];
  }

  set packageNames(value) {
    this._packageNames = Array.isArray(value) ? value : [];
  }

  async collectValidationErrors() {
    const errors = await super.collectValidationErrors();
    const installErrors = await validatePackageInstallSelection(this.packages ?? []);
    return [...errors, ...installErrors];
  }

  /**
   * Load package rows for stored guids and set {@link InstanceEntity#packageNames}.
   *
   * @returns {Promise<this>}
   */
  async resolvePackageNames() {
    const PackageStorage = require("../../src/storage/packageStorage");
    const packageGuids = (this.packages ?? [])
      .map((entry) => entry.packageGuid)
      .filter(Boolean);
    const packages = packageGuids.length
      ? await PackageStorage.global().load(packageGuids, { skipEvents: true })
      : [];

    this.packageNames = packages
      .map((pkg) => pkg.machineName)
      .sort();

    return this;
  }
}

module.exports = InstanceEntity;
