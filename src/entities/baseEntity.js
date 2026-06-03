const { getTransactionClient } = require("../db/transactionContext");

class BaseEntity {
  /**
   * Input field definitions keyed by property name.
   * Each spec: `{ label?, type, default?, required?, refs? }`
   * Types: `text`, `guid`, `number`, `integer`.
   * `refs`: required on `guid` fields — entity class with `static getStorage()` for existence checks.
   */
  static fields = {};

  /**
   * @returns {typeof import("../storage/baseStorage").BaseStorage}
   */
  static getStorage() {
    throw new Error(`${this.name} does not define static getStorage()`);
  }

  /** @type {string[]} Loaded from storage; not applied by {@link BaseEntity#set}. */
  static readOnlyFields = [];

  constructor({ instanceGuid, guid, isNew = false, storage = null } = {}) {
    this.instanceGuid = instanceGuid;
    this.guid = guid;
    this.isNew = isNew;
    this.storage = storage;
    this.validated = false;
  }

  /** @type {string[]} Keys applied by {@link BaseEntity#set} (derived from {@link BaseEntity.fields}). */
  static get inputFields() {
    return Object.keys(this.fields);
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
    for (const [key, spec] of Object.entries(this.constructor.fields)) {
      this[key] = options[key] !== undefined ? options[key] : EntityFieldTypes.defaultFor(spec);
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
    for (const [key, spec] of Object.entries(this.constructor.fields)) {
      if (key in values) {
        this[key] = this.coerceField(key, values[key]);
      }
    }
  }

  coerceField(key, value) {
    const spec = this.constructor.fields[key];
    return EntityFieldTypes.coerce(value, { ...spec, key });
  }

  filterInput(input = {}) {
    const values = {};
    for (const key of this.constructor.inputFields) {
      if (input[key] !== undefined) {
        values[key] = input[key];
      }
    }
    return values;
  }

  async collectValidationErrors() {
    const context = { instanceGuid: this.instanceGuid };
    const messages = await Promise.all(
      Object.entries(this.constructor.fields).map(async ([key, spec]) =>
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
    const exists = await storageClass.forInstance(context.instanceGuid).exists(value);
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
