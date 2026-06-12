const { BaseEntity } = require("./baseEntity");
const { UserEntity } = require("./userEntity");
const {
  CharacterPreCreateEvent,
  CharacterPostCreateEvent,
  CharacterPreUpdateEvent,
  CharacterPostUpdateEvent,
  CharacterPreDeleteEvent,
  CharacterPostDeleteEvent,
  CharacterPreGetEvent,
  CharacterPostGetEvent,
} = require("../../genrpg/events/characterEvents");

class CharacterEntity extends BaseEntity {
  static key = "character";

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

  static fields = {
    userGuid: { label: "User", type: "guid", refs: UserEntity },
    displayName: { label: "Display name", type: "text" },
    fullName: { label: "Full name", type: "text" },
    appearance: { label: "Appearance", type: "text", inputType: "textarea" },
    pronouns: { label: "Pronouns", type: "text" },
    createDatetime: { readOnly: true },
    updateDatetime: { readOnly: true },
    packageData: { readOnly: true, virtual: true, default: {} },
  };

  static getStorage() {
    return require("../storage/characterStorage");
  }

  constructor(options = {}) {
    super(options);
    this.initFields(options);
  }

  static async getFormSchema(context) {
    const extensionFieldSpecs = await this.getStorage().forInstance(context.instance).getExtensionFieldSpecs();

    const UserStorage = require("../storage/userStorage");
    const instanceUsers = await UserStorage.global().listForInstance(context.instance.guid);

    const coreFields = Object.entries(CharacterEntity.fields)
      .filter(([, spec]) => !spec.readOnly)
      .map(([key, spec]) => {
      if (key === "userGuid") {
        return this.formFieldFromSpec(key, spec, {
          inputType: "select",
          options: instanceUsers.map((user) => ({
            value: user.guid,
            label: user.displayName || user.email || user.guid,
          })),
        });
      }
      return this.formFieldFromSpec(key, spec);
    });
    const groups = [
      { id: "core", label: "Character", fields: coreFields },
      ...this.buildExtensionFormGroups(extensionFieldSpecs, context),
    ];

    return { groups: groups.filter((group) => group.fields.length) };
  }
}

module.exports = { CharacterEntity };
