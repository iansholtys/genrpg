const { BaseEntity } = require("./baseEntity");

class UserEntity extends BaseEntity {
  static key = "user";

  static fields = {
    email: { label: "Email", type: "text" },
    displayName: { label: "Display name", type: "text" },
    admin: { label: "Admin", type: "boolean" },
    oidcIssuer: { readOnly: true, excludeFromJson: true },
    oidcSubject: { readOnly: true, excludeFromJson: true },
    createDatetime: { readOnly: true },
    updateDatetime: { readOnly: true },
  };

  static getStorage() {
    return require("../storage/userStorage");
  }

  constructor(options = {}) {
    super(options);
    this.initFields(options);
  }
}

module.exports = { UserEntity };
