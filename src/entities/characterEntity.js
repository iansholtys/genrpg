const { mergeExtensionFieldSpecs } = require("../lib/entityExtensionIndex");
const { BaseEntity } = require("./baseEntity");
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
    displayName: { label: "Display name", type: "text" },
    fullName: { label: "Full name", type: "text" },
    appearance: { label: "Appearance", type: "text", inputType: "textarea" },
    pronouns: { label: "Pronouns", type: "text" },
  };

  static readOnlyFields = ["userGuid", "createDatetime", "updateDatetime", "packageData"];

  static getStorage() {
    return require("../storage/characterStorage");
  }

  constructor(options = {}) {
    super(options);
    this.initFields(options);
  }

  static async getFormSchema(context) {
    const packageNames = Object.keys(context.instance.packages);
    const extensionFieldSpecs = mergeExtensionFieldSpecs(
      CharacterEntity.key,
      packageNames,
      Object.keys(CharacterEntity.fields),
    );

    const coreFields = Object.entries(CharacterEntity.fields).map(([key, spec]) =>
      this.formFieldFromSpec(key, spec),
    );

    const groups = [
      { id: "core", label: "Character", fields: coreFields },
      ...this.buildExtensionFormGroups(extensionFieldSpecs, context),
    ];

    return { groups: groups.filter((group) => group.fields.length) };
  }

  toJSON() {
    return {
      guid: this.guid,
      instanceGuid: this.instanceGuid,
      userGuid: this.userGuid,
      displayName: this.displayName,
      fullName: this.fullName,
      appearance: this.appearance,
      pronouns: this.pronouns,
      createDatetime: this.createDatetime,
      updateDatetime: this.updateDatetime,
      ...super.toJSON(),
    };
  }
}

module.exports = {
  CharacterEntity,
};
