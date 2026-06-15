const { BaseEntity } = require("../../src/entities/baseEntity");

class ItemTemplateEntity extends BaseEntity {
  static key = "item_template";
  static labelProperties = ["name"];

  static getStorage() {
    return require("../storage/itemTemplateStorage");
  }

  static async getFormSchema(context) {
    const storage = this.getStorage().forInstance(context.instance);
    const [fieldSpecs, extensionFieldSpecs] = await Promise.all([
      storage.getFieldSpecs(),
      storage.getExtensionFieldSpecs(),
    ]);

    const coreFields = await Promise.all(
      Object.entries(fieldSpecs)
        .filter(([, spec]) => !spec.readOnly)
        .map(([key, spec]) => this.formFieldFromSpec(key, spec, { instance: context.instance })),
    );

    const groups = [
      { id: "core", label: "Item Template", fields: coreFields },
      ...(await this.buildExtensionFormGroups(extensionFieldSpecs, context)),
    ];

    return { groups: groups.filter((group) => group.fields.length) };
  }
}

module.exports = ItemTemplateEntity;
