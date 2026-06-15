const { BaseEntity } = require("../../src/entities/baseEntity");

class ItemCollectionEntity extends BaseEntity {
  static key = "item_collection";
  static labelProperties = ["name", "type"];

  static getStorage() {
    return require("../storage/itemCollectionStorage");
  }

  static async getFormSchema(context) {
    const storage = this.getStorage().forInstance(context.instance);
    const [fieldSpecs, extensionFieldSpecs] = await Promise.all([
      storage.getFieldSpecs(),
      storage.getExtensionFieldSpecs(),
    ]);

    const coreFields = await Promise.all(
      Object.entries(fieldSpecs)
        .filter(([, spec]) => !spec.readOnly && !spec.structured)
        .map(([key, spec]) => this.formFieldFromSpec(key, spec, { instance: context.instance })),
    );

    const groups = [
      { id: "core", label: "Item Collection", fields: coreFields },
      ...(await this.buildExtensionFormGroups(extensionFieldSpecs, context)),
    ];

    return { groups: groups.filter((group) => group.fields.length) };
  }

  async collectValidationErrors() {
    const errors = await super.collectValidationErrors();

    if (!Array.isArray(this.contents)) {
      return errors;
    }

    for (const entry of this.contents) {
      const hasItem = Boolean(entry?.itemGuid);
      const hasSubcollection = Boolean(entry?.subcollectionGuid);

      if (Number(hasItem) + Number(hasSubcollection) !== 1) {
        errors.push("Each collection entry must reference either an item or a subcollection");
      }
      if (Number.isInteger(entry?.quantity) && entry.quantity < 0) {
        errors.push("Quantity must be at least 0");
      }
      if (hasSubcollection && entry.subcollectionGuid === this.guid) {
        errors.push("A collection cannot contain itself");
      }
    }

    return errors;
  }
}

module.exports = ItemCollectionEntity;
