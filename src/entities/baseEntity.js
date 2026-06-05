const { getTransactionClient } = require("../db/transactionContext");

class BaseEntity {
  /**
   * Input field definitions keyed by property name.
   * Each spec: `{ label?, type, default?, required?, refs? }`
   * Types: `text`, `guid`, `number`, `integer`, `boolean`.
   * `refs`: required on `guid` fields — entity class with `static getStorage()` for existence checks.
   *
   * Package extension fields (when {@link BaseEntity.key} is set) are merged at runtime from
   * package entities.yml modules via {@link BaseEntity#extensionFieldSpecs}. Storage must pass
   * extension values as top-level constructor options; {@link BaseEntity#packageData} is read-only
   * metadata from the database, not used to hydrate input fields.
   */
  static fields = {};

  /**
   * Entity identifier for package extensions and persistence.
   * @type {string | null}
   */
  static key = null;

  /**
   * @returns {typeof import("../storage/baseStorage").BaseStorage}
   */
  static getStorage() {
    throw new Error(`${this.name} does not define static getStorage()`);
  }

  /** @type {string[]} Loaded from storage; not applied by {@link BaseEntity#set}. */
  static readOnlyFields = [];

  constructor({
    instanceGuid,
    guid,
    isNew = false,
    storage = null,
    packageNames = [],
    extensionFieldSpecs = null,
    packageData = null,
  } = {}) {
    this.instanceGuid = instanceGuid;
    this.guid = guid;
    this.isNew = isNew;
    this.storage = storage;
    this.validated = false;
    this.packageNames = packageNames;
    this.extensionFieldSpecs = extensionFieldSpecs || {};
    this.packageData = packageData || {};
    this.effectiveFields = {
      ...this.constructor.fields,
      ...this.extensionFieldSpecs,
    };
  }

  /** @type {string[]} Keys applied by {@link BaseEntity#set}. */
  get inputFields() {
    return Object.keys(this.effectiveFields);
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
      const raw = options[key] !== undefined ? options[key] : EntityFieldTypes.defaultFor(spec);
      this[key] = this.coerceField(key, raw, spec);
    }
    for (const key of this.constructor.readOnlyFields) {
      this[key] = options[key] !== undefined ? options[key] : null;
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
      instance: {
        guid: this.instanceGuid,
        packageNames: this.packageNames,
      },
    };
    const messages = await Promise.all(
      Object.entries(this.effectiveFields).map(async ([key, spec]) =>
        EntityFieldTypes.validate(this[key], { ...spec, key }, context),
      ),
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

  async save() {
    this.assertInTransaction();
    this.assertHasStorage();
    this.assertValidated();
    return this.storage.save(this);
  }

  async delete() {
    this.assertInTransaction();
    this.assertHasStorage();
    return this.storage.delete(this.guid);
  }

  toJSON() {
    throw new Error(`toJSON() not implemented for ${this.constructor.name}`);
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
    const exists = await storageClass.forInstance(context.instance).exists(value);
    if (!exists) {
      return `${this.fieldLabel(spec)} not found for this instance`;
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
