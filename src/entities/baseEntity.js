const { getTransactionClient } = require("../db/transactionContext");
const { ValidationError } = require("../errors/ValidationError");
const { getEventDispatcher } = require("../events/packageEvents");
const { collectFieldValidationErrors } = require("../fields/fieldStorage");

class BaseEntity {
  /**
   * @deprecated Unported entities still declare {@link BaseEntity.fields}; ported entities
   * use manifest field specs via {@link BaseStorage#getFieldSpecs} only.
   */
  static fields = {};

  /**
   * Entity identifier for manifest field lookup and persistence.
   * @type {string | null}
   */
  static key = null;

  /**
   * Manifest field properties tried in order when labeling this entity in selects.
   * Falls back to `entity.guid` when no property is set.
   */
  static labelProperties = [];

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
   * Display label for this entity in selects and similar UI.
   * @param {{ guid: string, [key: string]: unknown }} entity
   */
  static entityLabel(entity) {
    for (const property of this.labelProperties) {
      const value = entity[property];
      if (value !== null && value !== undefined && value !== "") {
        return String(value);
      }
    }
    return entity.guid;
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
   *
   * @param {string} key
   * @param {object} spec
   * @param {{ instance?: object, overrides?: object }} [options]
   * @param {object} [options.instance] when set, loads select options for instance-scoped entityRef fields
   * @param {object} [options.overrides] form field overrides (inputType, options, …)
   */
  static async formFieldFromSpec(key, spec, options = {}) {
    const { instance, overrides = {} } = options;

    if (spec.readOnly) {
      throw new Error(`Cannot build form field for read-only property: ${key}`);
    }

    if (spec.refs && !overrides.options) {
      const RefEntity = spec.refs;
      const StorageClass = RefEntity.getStorage();
      if (StorageClass.instanceScoped) {
        if (!instance) {
          throw new Error(`formFieldFromSpec("${key}"): instance is required for instance-scoped entityRef`);
        }
        const entities = await StorageClass.forInstance(instance).list();
        return this.formSelectFromSpec(key, spec, entities, overrides);
      }

      const entities = await StorageClass.global().list();
      return this.formSelectFromSpec(key, spec, entities, overrides);
    }

    if (spec.inputType === "textarea") {
      return this.buildFormFieldFromSpec(key, spec, { inputType: "textarea", ...overrides });
    }

    return this.buildFormFieldFromSpec(key, spec, overrides);
  }

  /**
   * Builds a select form field from a pre-loaded list of referenced entities.
   *
   * @param {string} key
   * @param {object} spec field spec with {@link BaseEntity.formSelectFromSpec refs}
   * @param {Array<{ guid: string }>} entities
   * @param {object} [overrides]
   */
  static formSelectFromSpec(key, spec, entities, overrides = {}) {
    const RefEntity = spec.refs;
    if (!RefEntity) {
      throw new Error(`formSelectFromSpec requires spec.refs on field "${key}"`);
    }

    return this.buildFormFieldFromSpec(key, spec, {
      inputType: "select",
      options: entities.map((entity) => ({
        value: entity.guid,
        label: RefEntity.entityLabel(entity),
      })),
      ...overrides,
    });
  }

  static buildFormFieldFromSpec(key, spec, overrides = {}) {
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
   * Whether a manifest field spec should appear in {@link BaseEntity.getFormSchema}.
   * @param {string} _key
   * @param {object} spec
   */
  static includeFormField(_key, spec) {
    return !spec.readOnly && !spec.structured;
  }

  /**
   * Build one form field descriptor. Override for entity-specific select options or overrides.
   *
   * @param {string} key
   * @param {object} spec
   * @param {{ instance: object }} context
   */
  static async buildFormField(key, spec, context) {
    return this.formFieldFromSpec(key, spec, { instance: context.instance });
  }

  /**
   * Form metadata for instance-scoped admin UI (`GET …/form`).
   *
   * @param {{ instance: object }} context
   * @returns {Promise<{ fields: object[] }>}
   */
  static async getFormSchema(context) {
    const storage = this.getStorage().forInstance(context.instance);
    const fieldSpecs = await storage.getFieldSpecs();

    const fields = await Promise.all(
      Object.entries(fieldSpecs)
        .filter(([key, spec]) => this.includeFormField(key, spec))
        .map(([key, spec]) => this.buildFormField(key, spec, context)),
    );

    return { fields };
  }

  constructor({
    instanceGuid,
    guid,
    isNew = false,
    storage = null,
    fieldSpecs = {},
    coreFieldSpecs = {},
    createDatetime = null,
    updateDatetime = null,
    ...fieldValues
  } = {}) {
    this.instanceGuid = instanceGuid;
    this.guid = guid;
    this.isNew = isNew;
    this.storage = storage;
    this.validated = false;
    this.createDatetime = createDatetime;
    this.updateDatetime = updateDatetime;
    this._fieldSpecs = fieldSpecs;
    this._coreFieldSpecs = coreFieldSpecs;
    this.initFields(fieldValues);
    this.initCoreFields(fieldValues);
  }

  /** Base-table field specs from the entity manifest (not field-table data). */
  get coreFieldSpecs() {
    return this._coreFieldSpecs;
  }

  /** Assign manifest core fields from constructor options. */
  initCoreFields(options = {}) {
    for (const property of Object.keys(this._coreFieldSpecs)) {
      if (property in options) {
        this[property] = options[property];
      }
    }
  }

  /** Manifest-driven field specs, resolved by storage at hydration time. */
  get fieldSpecs() {
    return this._fieldSpecs;
  }

  /** Package machine names for this entity's instance, from bound storage. */
  get packageNames() {
    return this.storage?.packageNames ?? [];
  }

  /** @type {string[]} Keys applied by {@link BaseEntity#set}. */
  get inputFields() {
    return Object.keys(this.fieldSpecs).filter((key) => !this.fieldSpecs[key].readOnly);
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
    for (const [key, spec] of Object.entries(this.fieldSpecs)) {
      let raw;
      if (key in options) {
        raw = options[key];
      } else if (spec.default !== undefined) {
        raw = spec.default;
      } else if (spec.cardinality !== 1) {
        raw = [];
      } else if (spec.readOnly) {
        raw = null;
      } else if (spec.structured) {
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
    for (const [key, spec] of Object.entries(this.fieldSpecs)) {
      if (key in values) {
        if (spec.readOnly || !spec.type) {
          this[key] = values[key];
        } else {
          this[key] = this.coerceField(key, values[key], spec);
        }
      }
    }
  }

  coerceField(key, value, spec = null) {
    const fieldSpec = spec || this.fieldSpecs[key];
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

    const manifestSpecs = await this.storage.getFieldManifestSpecs();
    const fieldErrors = await collectFieldValidationErrors(this, manifestSpecs, context);

    return fieldErrors.filter(Boolean);
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
   * API response shape: identity, core fields, and manifest field values.
   */
  toJSON() {
    const payload = { guid: this.guid };

    if (this.instanceGuid != null) {
      payload.instanceGuid = this.instanceGuid;
    }

    if (this.createDatetime != null) {
      payload.createDatetime = this.createDatetime;
    }
    if (this.updateDatetime != null) {
      payload.updateDatetime = this.updateDatetime;
    }

    for (const key of Object.keys(this.fieldSpecs)) {
      payload[key] = this[key];
    }

    for (const [property, spec] of Object.entries(this.coreFieldSpecs)) {
      if (spec.public) {
        payload[property] = this[property];
      }
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
      return null;
    }
    const storageClass = spec.refs.getStorage();
    const storage = storageClass.instanceScoped === false
      ? storageClass.global()
      : storageClass.forInstance(context.instance);
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

  static coerceStructuredEntry(entry, spec) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return entry;
    }

    const coerced = {};
    for (const columnSpec of spec.columns) {
      const raw = Object.hasOwn(entry, columnSpec.key)
        ? entry[columnSpec.key]
        : (columnSpec.default !== undefined ? columnSpec.default : null);
      coerced[columnSpec.key] = this.coerce(raw, columnSpec);
    }
    return coerced;
  }

  static coerceStructured(value, spec) {
    if (value == null) {
      return spec.cardinality !== 1 ? [] : null;
    }

    if (spec.cardinality !== 1) {
      if (!Array.isArray(value)) {
        return value;
      }
      return value.map((entry) => this.coerceStructuredEntry(entry, spec));
    }

    if (typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    return this.coerceStructuredEntry(value, spec);
  }

  static coerce(value, spec) {
    if (spec.structured) {
      return this.coerceStructured(value, spec);
    }
    return this.getHandler(spec.type).coerce(value, spec);
  }

  static validate(value, spec, context) {
    return this.getHandler(spec.type).validate(value, spec, context);
  }
}

module.exports = { BaseEntity, EntityFieldTypes };
