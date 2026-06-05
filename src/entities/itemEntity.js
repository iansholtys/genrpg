const { BaseEntity } = require("./baseEntity");
const { ItemTemplateEntity } = require("./itemTemplateEntity");
const { loadPackages } = require("../packages");
const { mergeExtensionFieldSpecs } = require("../lib/entityExtensionIndex");

function inputTypeForField(key, spec) {
  switch (spec.type) {
    case "boolean":
      return "checkbox";
    case "number":
    case "integer":
      return "number";
    case "guid":
      return "select";
    case "text":
      return key === "description" ? "textarea" : "text";
    default:
      return "text";
  }
}

function formFieldFromSpec(key, spec, overrides = {}) {
  const field = {
    key,
    label: spec.label || key,
    type: spec.type,
    required: !!spec.required,
    inputType: overrides.inputType || inputTypeForField(key, spec),
    ...overrides,
  };

  if (field.type === "number") {
    field.step = "any";
  }
  if (field.type === "integer") {
    field.step = "1";
  }

  return field;
}

class ItemEntity extends BaseEntity {
  static key = "item";

  static getStorage() {
    return require("../storage/itemStorage");
  }

  static fields = {
    itemTemplateGuid: {
      label: "Item template",
      type: "guid",
      required: true,
      refs: ItemTemplateEntity,
    },
    name: { label: "Name", type: "text" },
    description: { label: "Description", type: "text" },
    weight: { label: "Weight", type: "number" },
  };

  static readOnlyFields = [
    "createDatetime",
    "updateDatetime",
    "itemTemplate",
    "effectiveName",
    "effectiveDescription",
    "effectiveWeight",
    "packageData",
  ];

  constructor(options = {}) {
    super(options);
    this.initFields(options);
  }

  static async getFormSchema(context) {
    const ItemTemplateStorage = require("../storage/itemTemplateStorage");

    const packageNames = context.instance.packageNames ?? [];
    const extensionFieldSpecs = mergeExtensionFieldSpecs(
      ItemEntity.key,
      packageNames,
      Object.keys(ItemEntity.fields),
    );
    const templates = await ItemTemplateStorage.forInstance(context.instance).list();
    const { packages } = await loadPackages({ strict: false });
    const packageLabels = new Map(packages.map((pkg) => [pkg.machineName, pkg.name]));

    const coreFields = Object.entries(ItemEntity.fields).map(([key, spec]) => {
      if (key === "itemTemplateGuid") {
        return formFieldFromSpec(key, spec, {
          inputType: "select",
          options: templates.map((template) => ({
            value: template.guid,
            label: template.name || template.guid,
          })),
        });
      }
      return formFieldFromSpec(key, spec);
    });

    const extensionGroups = new Map();
    for (const [key, spec] of Object.entries(extensionFieldSpecs)) {
      if (!extensionGroups.has(spec.schema)) {
        extensionGroups.set(spec.schema, {
          id: spec.schema,
          label: packageLabels.get(spec.schema) || spec.schema,
          fields: [],
        });
      }
      extensionGroups.get(spec.schema).fields.push(formFieldFromSpec(key, spec));
    }

    const groups = [{ id: "core", label: "Item", fields: coreFields }, ...extensionGroups.values()];

    return { groups: groups.filter((group) => group.fields.length) };
  }

  toJSON() {
    const payload = {
      guid: this.guid,
      instanceGuid: this.instanceGuid,
      itemTemplateGuid: this.itemTemplateGuid,
      name: this.name,
      description: this.description,
      weight: this.weight,
      createDatetime: this.createDatetime,
      updateDatetime: this.updateDatetime,
      itemTemplate: this.itemTemplate,
      effectiveName: this.effectiveName,
      effectiveDescription: this.effectiveDescription,
      effectiveWeight: this.effectiveWeight,
    };

    for (const key of Object.keys(this.extensionFieldSpecs)) {
      payload[key] = this[key];
    }

    if (Object.keys(this.packageData).length) {
      payload.packageData = this.packageData;
    }

    return payload;
  }
}

module.exports = { ItemEntity };
