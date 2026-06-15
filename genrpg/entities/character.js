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

  static async getFormSchema(context) {
    const storage = this.getStorage().forInstance(context.instance);
    const fieldSpecs = await storage.getFieldSpecs();

    const UserStorage = require("../../src/storage/userStorage");
    const instanceUsers = await UserStorage.global().listForInstance(context.instance.guid);

    const coreFields = await Promise.all(
      Object.entries(fieldSpecs)
        .filter(([, spec]) => !spec.readOnly && !spec.structured)
        .map(([key, spec]) => {
          if (key === "userGuid") {
            return this.formSelectFromSpec(key, spec, instanceUsers);
          }
          return this.formFieldFromSpec(key, spec, { instance: context.instance });
        }),
    );

    return {
      groups: [{ id: "core", label: "Character", fields: coreFields }],
    };
  }
}

module.exports = CharacterEntity;
