const { BaseEntity } = require("../../src/entities/baseEntity");

class RoleEntity extends BaseEntity {
  static key = "role";
  static labelProperties = ["name"];

  static getStorage() {
    return require("../../src/storage/roleStorage");
  }

  async collectValidationErrors() {
    const errors = await super.collectValidationErrors();
    const name = typeof this.name === "string" ? this.name.trim() : "";

    if (!name) {
      return errors;
    }

    const RoleStorage = require("../../src/storage/roleStorage");
    const existing = await RoleStorage.global().list({ name, skipEvents: true });
    if (existing.some((role) => role.guid !== this.guid)) {
      errors.push(`A role named "${name}" already exists`);
    }

    return errors;
  }
}

module.exports = RoleEntity;
