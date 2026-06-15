const { BaseEntity } = require("./baseEntity");

class UserEntity extends BaseEntity {
  static key = "user";
  static labelProperties = ["displayName", "email"];

  static getStorage() {
    return require("../storage/userStorage");
  }
}

module.exports = UserEntity;
