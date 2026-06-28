const { BaseEntity } = require("../../src/entities/baseEntity");
const { trimmedString } = require("../../src/lib/strings");

class PermissionEntity extends BaseEntity {
  static key = "permission";
  static labelProperties = ["name"];

  static getStorage() {
    return require("../../src/storage/permissionStorage");
  }

  async collectValidationErrors() {
    const errors = await super.collectValidationErrors();
    const name = trimmedString(this.name);

    if (!name) {
      return errors;
    }

    const PermissionStorage = require("../../src/storage/permissionStorage");
    const existing = await PermissionStorage.global().list({ name, skipEvents: true });
    if (existing.some((permission) => permission.guid !== this.guid)) {
      errors.push(`A permission named "${name}" already exists`);
    }

    return errors;
  }
}

module.exports = PermissionEntity;
