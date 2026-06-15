const { BaseEntity } = require("../../src/entities/baseEntity");
const {
  CharacterPreCreateEvent,
  CharacterPostCreateEvent,
  CharacterPreUpdateEvent,
  CharacterPostUpdateEvent,
  CharacterPreDeleteEvent,
  CharacterPostDeleteEvent,
  CharacterPreGetEvent,
  CharacterPostGetEvent,
} = require("../events/characterEvents");

class CharacterEntity extends BaseEntity {
  static key = "character";
  static labelProperties = ["displayName", "fullName"];

  static events = {
    preGet: CharacterPreGetEvent,
    postGet: CharacterPostGetEvent,
    preCreate: CharacterPreCreateEvent,
    postCreate: CharacterPostCreateEvent,
    preUpdate: CharacterPreUpdateEvent,
    postUpdate: CharacterPostUpdateEvent,
    preDelete: CharacterPreDeleteEvent,
    postDelete: CharacterPostDeleteEvent,
  };

  static getStorage() {
    return require("../storage/characterStorage");
  }

  static async buildFormField(key, spec, context) {
    if (key === "userGuid") {
      const UserStorage = require("../../src/storage/userStorage");
      const instanceUsers = await UserStorage.global().listForInstance(context.instance.guid);
      return this.formSelectFromSpec(key, spec, instanceUsers);
    }

    return super.buildFormField(key, spec, context);
  }
}

module.exports = CharacterEntity;
