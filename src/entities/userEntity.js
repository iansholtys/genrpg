const { BaseEntity } = require("./baseEntity");

class UserEntity extends BaseEntity {
  static key = "user";
  static labelProperties = ["displayName", "email"];

  static getStorage() {
    return require("../storage/userStorage");
  }

  async collectValidationErrors() {
    const errors = await super.collectValidationErrors();
    const seenInstances = new Set();

    for (const entry of this.instanceRoles ?? []) {
      const instanceGuid = entry?.instanceGuid;
      if (!instanceGuid) {
        errors.push("Each instance role assignment requires an instance");
        continue;
      }

      if (seenInstances.has(instanceGuid)) {
        errors.push("Each instance may have at most one role assignment per user");
      } else {
        seenInstances.add(instanceGuid);
      }
    }

    return errors;
  }
}

module.exports = UserEntity;
