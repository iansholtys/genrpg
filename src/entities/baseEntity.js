const { getTransactionClient } = require("../db/transactionContext");
const { ValidationError } = require("../errors/ValidationError");
const { getEventDispatcher } = require("../events/packageEvents");

class BaseEntity {
  /**
   * Field definitions keyed by property name.
   * Each spec: `{ label?, type?, default?, required?, refs?, inputType?, readOnly?, virtual?, nested?, excludeFromJson? }`
   *
   * Types (when `type` is set): `text`, `guid`, `number`, `integer`, `boolean`.
   * `refs`: required on editable `guid` fields — entity class with `static getStorage()` for existence checks.
   *
   * `readOnly`: loaded from storage but excluded from {@link BaseEntity#set} and form schemas.
   * `virtual`: not a persisted core-table column (excluded from SELECT); used for enrichment/aggregates.
   * `nested`: on virtual fields — serialize loaded entity relations via `toJSON()`.
   * `excludeFromJson`: omit from {@link BaseEntity#toJSON} output.
   *
   * Package extension fields (when {@link BaseEntity.key} is set) are merged at runtime from
   * package entities.yml modules via bound storage {@link BaseStorage#getExtensionFieldSpecs}.
   */
  static fields = {};

  /**
   * Entity identifier for package extensions and persistence.
   * @type {string | null}
   */
  static key = null;

  /**
   * Maps lifecycle phases to package event classes, e.g. `{ preCreate, postCreate, … }`.
   * @type {Record<string, typeof import("../events/BaseEvent").BaseEvent>}
   */
  static events = {};

  /**
   * Dispatch a configured lifecycle event for this entity type.
   *
   * Uses {@link BaseEntity#packageNames} (from bound storage) for subscriber routing.
   *
   * @param {string} phase e.g. `preCreate`, `postGet`
   * @param {object} eventArgs payload passed to the event constructor
   * @returns {Promise<import("../events/BaseEvent").BaseEvent | null>}
   */
  async dispatchEvent(phase, eventArgs) {
    const EventClass = this.constructor.events?.[phase];
    if (!EventClass) {
      return null;
    }

    const dispatcher = await getEventDispatcher();
    const event = new EventClass(eventArgs);
    await dispatcher.dispatch(event, this.packageNames);

    if (event.errors?.length) {
      throw new ValidationError(event.errors);
    }

    return event;
  }

  /**
   * @returns {typeof import("../storage/baseStorage").BaseStorage}
   */
  static getStorage() {
    throw new Error(`${this.name} does not define static getStorage()`);
  }

  /**
   * Default HTML input type for a field spec. Explicit `spec.inputType` wins.
   */
  static defaultInputType(spec) {
    if (spec.inputType) {
      return spec.inputType;
    }

    switch (spec.type) {
      case "boolean":
        return "checkbox";
      case "number":
      case "integer":
        return "number";
      case "guid":
        return "select";
      case "text":
      default:
        return "text";
    }
  }

  /**
   * Builds a form field descriptor from a field spec for {@link BaseEntity.getFormSchema} metadata.
   */
  static formFieldFromSpec(key, spec, overrides = {}) {
    if (spec.readOnly) {
      throw new Error(`Cannot build form field for read-only property: ${key}`);
    }

    const field = {
      key,
      label: spec.label || key,
      type: spec.type,
      required: !!spec.required,
      inputType: this.defaultInputType(spec),
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

  /**
   * Builds form schema groups for package extension fields on this entity.
   */
  static buildExtensionFormGroups(extensionFieldSpecs, context) {
    const { packages } = context.instance;
    const groups = new Map();

    for (const [key, spec] of Object.entries(extensionFieldSpecs)) {
      if (!groups.has(spec.schema)) {
        groups.set(spec.schema, {
          id: spec.schema,
          label: packages[spec.schema] || spec.schema,
          fields: [],
        });
      }
      groups.get(spec.schema).fields.push(this.formFieldFromSpec(key, spec));
    }

    return [...groups.values()];
  }

  constructor({
    instanceGuid,
    guid,
    isNew = false,
    storage = null,
    extensionFieldSpecs = null,
  } = {}) {
    this.instanceGuid = instanceGuid;
    this.guid = guid;
    this.isNew = isNew;
    this.storage = storage;
    this.validated = false;
    this.extensionFieldSpecs = extensionFieldSpecs || {};
    this.effectiveFields = {
      ...this.constructor.fields,
      ...this.extensionFieldSpecs,
    };
  }

  /** Package machine names for this entity's instance, from bound storage. */
  get packageNames() {
    return this.storage?.packageNames ?? [];
  }

  /** @type {string[]} Keys applied by {@link BaseEntity#set}. */
  get inputFields() {
    return Object.keys(this.effectiveFields).filter((key) => !this.effectiveFields[key].readOnly);
  }

  assertHasStorage() {
    if (!this.storage) {
      throw new Error(`${this.constructor.name} has no storage reference`);
    }
  }

  assertInTransaction() {
    if (!getTransactionClient()) {
      throw new Error("Must be called inside withTransaction()");
    }
  }

  assertValidated() {
    if (!this.validated) {
      throw new Error(`${this.constructor.name} must be validated before save`);
    }
  }

  initFields(options = {}) {
    for (const [key, spec] of Object.entries(this.effectiveFields)) {
      let raw;
      if (key in options) {
        raw = options[key];
      } else if (spec.default !== undefined) {
        raw = spec.default;
      } else if (spec.readOnly) {
        raw = null;
      } else {
        raw = EntityFieldTypes.defaultFor(spec);
      }

      if (spec.readOnly || !spec.type) {
        this[key] = raw;
      } else {
        this[key] = this.coerceField(key, raw, spec);
      }
    }
  }

  set(values) {
    this.validated = false;
    this.applyFieldValues(this.filterInput(values));
  }

  applyFieldValues(values) {
    for (const [key, spec] of Object.entries(this.effectiveFields)) {
      if (key in values) {
        this[key] = this.coerceField(key, values[key], spec);
      }
    }
  }

  coerceField(key, value, spec = null) {
    const fieldSpec = spec || this.effectiveFields[key];
    return EntityFieldTypes.coerce(value, { ...fieldSpec, key });
  }

  filterInput(input = {}) {
    const values = {};
    for (const key of this.inputFields) {
      if (input[key] !== undefined) {
        values[key] = input[key];
      }
    }
    return values;
  }

  async collectValidationErrors() {
    const context = {
      instance: this.storage?.instance ?? {
        guid: this.instanceGuid,
        packages: Object.fromEntries(this.packageNames.map((name) => [name, name])),
      },
    };
    const messages = await Promise.all(
      this.inputFields.map(async (key) => {
        const spec = this.effectiveFields[key];
        return EntityFieldTypes.validate(this[key], { ...spec, key }, context);
      }),
    );
    return messages.filter(Boolean);
  }

  /**
   * @returns {Promise<string[]>} Empty when valid. Sets `validated` from the result.
   */
  async validate() {
    const errors = await this.collectValidationErrors();
    this.validated = errors.length === 0;
    return errors;
  }

  async save({ skipEvents = false } = {}) {
    this.assertInTransaction();
    this.assertHasStorage();
    this.assertValidated();

    if (skipEvents) {
      return this.storage.save(this);
    }

    const eventArgs = { entity: this, instance: this.storage.instance };
    const { isNew } = this;
    await this.dispatchEvent(
      isNew ? "preCreate" : "preUpdate",
      eventArgs,
    );

    const result = await this.storage.save(this);

    if (result) {
      await this.dispatchEvent(
        isNew ? "postCreate" : "postUpdate",
        eventArgs,
      );
    }

    return result;
  }

  async delete({ skipEvents = false } = {}) {
    this.assertInTransaction();
    this.assertHasStorage();

    if (skipEvents) {
      return this.storage.delete(this.guid);
    }

    const eventArgs = { entity: this, instance: this.storage.instance };
    await this.dispatchEvent("preDelete", eventArgs);

    const deleted = await this.storage.delete(this.guid);
    if (deleted) {
      await this.dispatchEvent("postDelete", eventArgs);
    }

    return deleted;
  }

  /**
   * API response shape: identity, core fields, nested virtual relations,
   * package extension fields, and non-empty package metadata.
   */
  toJSON() {
    const payload = { guid: this.guid };

    if (this.instanceGuid != null) {
      payload.instanceGuid = this.instanceGuid;
    }

    for (const [key, spec] of Object.entries(this.constructor.fields)) {
      if (spec.excludeFromJson) {
        continue;
      }
      if (spec.virtual) {
        if (spec.nested) {
          payload[key] = this[key]?.toJSON?.() ?? null;
        }
        continue;
      }
      payload[key] = this[key];
    }

    for (const key of Object.keys(this.extensionFieldSpecs)) {
      payload[key] = this[key];
    }

    if (this.packageData && Object.keys(this.packageData).length) {
      payload.packageData = this.packageData;
    }

    return payload;
  }
}

class EntityFieldTypes {
  static isSet(value) {
    return value !== null && value !== undefined;
  }

  static isString(value, required = false) {
    if (!this.isSet(value)) {
      return !required;
    }
    return typeof value === "string";
  }

  static isNonEmptyString(value, required = false) {
    if (!this.isSet(value)) {
      return !required;
    }
    return typeof value === "string" && value !== "";
  }

  static isNumber(value, required = false) {
    if (!this.isSet(value)) {
      return !required;
    }
    return typeof value === "number" && Number.isFinite(value);
  }

  static isInteger(value, required = false) {
    if (!this.isSet(value)) {
      return !required;
    }
    return Number.isInteger(value);
  }

  static isBoolean(value, required = false) {
    if (!this.isSet(value)) {
      return !required;
    }
    return typeof value === "boolean";
  }

  static coerceString(value, required = false) {
    if (value === null || value === undefined) {
      return required ? value : null;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!required && trimmed === "") {
        return null;
      }
      return trimmed;
    }
    return value;
  }

  static coerceNumeric(value, { required = false, integer = false } = {}) {
    if (value === null || value === undefined || value === "") {
      return required ? value : null;
    }

    const isValid = integer ? (n) => Number.isInteger(n) : (n) => Number.isFinite(n);

    if (typeof value === "number" && isValid(value)) {
      return value;
    }

    const parsed = Number(value);
    return isValid(parsed) ? parsed : value;
  }

  static coerceNumber(value, required = false) {
    return this.coerceNumeric(value, { required });
  }

  static coerceInteger(value, required = false) {
    return this.coerceNumeric(value, { required, integer: true });
  }

  static fieldLabel(spec) {
    return spec.label ?? spec.key;
  }

  static isRequired(spec) {
    return !!spec.required;
  }

  static validateString(value, spec) {
    const required = this.isRequired(spec);
    if (!this.isString(value, required)) {
      return `${this.fieldLabel(spec)} must be a string`;
    }
    if (required && !this.isNonEmptyString(value, true)) {
      return `${this.fieldLabel(spec)} is required`;
    }
    return null;
  }

  static validateNumber(value, spec) {
    const required = this.isRequired(spec);
    if (!this.isNumber(value, required)) {
      return `${this.fieldLabel(spec)} must be a number`;
    }
    return null;
  }

  static validateInteger(value, spec) {
    const required = this.isRequired(spec);
    if (!this.isInteger(value, required)) {
      return `${this.fieldLabel(spec)} must be an integer`;
    }
    return null;
  }

  static validateBoolean(value, spec) {
    const required = this.isRequired(spec);
    if (!this.isBoolean(value, required)) {
      return `${this.fieldLabel(spec)} must be a boolean`;
    }
    return null;
  }

  static coerceBoolean(value, required = false) {
    if (value === null || value === undefined || value === "") {
      return required ? value : null;
    }
    if (typeof value === "boolean") {
      return value;
    }
    if (value === "true" || value === "1" || value === 1) {
      return true;
    }
    if (value === "false" || value === "0" || value === 0) {
      return false;
    }
    return value;
  }

  static async validateGuid(value, spec, context) {
    if (!this.isSet(value) || value === "") {
      if (this.isRequired(spec)) {
        return `${this.fieldLabel(spec)} is required`;
      }
      return null;
    }
    if (!this.isString(value, true)) {
      return `${this.fieldLabel(spec)} must be a string`;
    }
    if (!spec.refs) {
      return `${this.fieldLabel(spec)} must declare refs`;
    }
    const storageClass = spec.refs.getStorage();
    const storage = storageClass.forInstance(context.instance);
    const exists = await storage.exists(value);
    if (!exists) {
      const scope = storageClass.instanceScoped === false ? "" : " for this instance";
      return `${this.fieldLabel(spec)} not found${scope}`;
    }
    return null;
  }

  static types = {
    text: {
      default: null,
      coerce(value, spec) {
        const required = EntityFieldTypes.isRequired(spec);
        return EntityFieldTypes.coerceString(value, required);
      },
      validate(value, spec) {
        return EntityFieldTypes.validateString(value, spec);
      },
    },
    guid: {
      default: null,
      coerce(value, spec) {
        const required = EntityFieldTypes.isRequired(spec);
        return EntityFieldTypes.coerceString(value, required);
      },
      validate(value, spec, context) {
        return EntityFieldTypes.validateGuid(value, spec, context);
      },
    },
    number: {
      default: null,
      coerce(value, spec) {
        const required = EntityFieldTypes.isRequired(spec);
        return EntityFieldTypes.coerceNumber(value, required);
      },
      validate(value, spec) {
        return EntityFieldTypes.validateNumber(value, spec);
      },
    },
    integer: {
      default: null,
      coerce(value, spec) {
        const required = EntityFieldTypes.isRequired(spec);
        return EntityFieldTypes.coerceInteger(value, required);
      },
      validate(value, spec) {
        return EntityFieldTypes.validateInteger(value, spec);
      },
    },
    boolean: {
      default: null,
      coerce(value, spec) {
        const required = EntityFieldTypes.isRequired(spec);
        return EntityFieldTypes.coerceBoolean(value, required);
      },
      validate(value, spec) {
        return EntityFieldTypes.validateBoolean(value, spec);
      },
    },
  };

  static getHandler(type) {
    const handler = this.types[type];
    if (!handler) {
      throw new Error(`Unknown entity field type: ${type}`);
    }
    return handler;
  }

  static defaultFor(spec) {
    if (spec.default !== undefined) {
      return spec.default;
    }
    return this.getHandler(spec.type).default;
  }

  static coerce(value, spec) {
    return this.getHandler(spec.type).coerce(value, spec);
  }

  static validate(value, spec, context) {
    return this.getHandler(spec.type).validate(value, spec, context);
  }
}

module.exports = { BaseEntity };
