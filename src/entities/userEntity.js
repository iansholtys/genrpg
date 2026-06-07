const { BaseEntity } = require("./baseEntity");

class UserEntity extends BaseEntity {
  static key = "user";

  static fields = {
    email: { label: "Email", type: "text" },
    displayName: { label: "Display name", type: "text" },
    admin: { label: "Admin", type: "boolean" },
    oidcIssuer: { readOnly: true },
    oidcSubject: { readOnly: true },
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

  toJSON() {
    return {
      guid: this.guid,
      email: this.email,
      displayName: this.displayName,
      admin: this.admin,
    };
  }
}

module.exports = { UserEntity };
