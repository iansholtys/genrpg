const { selectQuery, insertQuery, deleteQuery, qualify } = require("../services/queryService");
const { loadMergedFieldSpecs, loadEntityClassesByKey } = require("./fieldManifest");

const SCALAR_FIELD_TYPES = new Set(["text", "integer", "number", "boolean", "entityRef", "richText"]);

/**
 * SQL alias for a single-value field table LEFT JOIN.
 * @param {object} spec normalized field spec
 */
function fieldJoinAlias(spec) {
  return `f_${spec.column}`;
}

/**
 * SELECT alias for a payload column on a joined field table.
 * @param {object} spec
 * @param {string} columnName
 */
function fieldSelectAlias(spec, columnName) {
  return `${fieldJoinAlias(spec)}__${columnName}`;
}

function columnNameToProperty(columnName) {
  return columnName.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

/**
 * Resolve an entity property path (`displayName`, `contents.itemGuid`) to a SQL column
 * target on the core or field table. Used for list/count filters and ordering.
 *
 * @param {string} propertyPath field property, optionally `field.column` (one dot max)
 * @param {Record<string, object>} manifestSpecs
 * @param {Record<string, { column: string }>} coreFieldsByProperty base-table properties
 * @returns {{ tableAlias: string, column: string } | { coreColumn: string }}
 */
function resolvePropertyPath(propertyPath, manifestSpecs, coreFieldsByProperty) {
  const parts = propertyPath.split(".");
  if (parts.length > 2) {
    throw new Error(`Invalid property "${propertyPath}": at most one "." is allowed`);
  }

  const [fieldProperty, columnProperty] = parts;
  const coreField = coreFieldsByProperty[fieldProperty];
  if (coreField) {
    if (columnProperty) {
      throw new Error(
        `Invalid property "${propertyPath}": core field "${fieldProperty}" cannot specify a column`,
      );
    }
    return { coreColumn: coreField.column };
  }

  const spec = manifestSpecs[fieldProperty];
  if (!spec) {
    throw new Error(`Unknown property "${fieldProperty}"`);
  }

  if (isMultiValue(spec)) {
    throw new Error(`Invalid property "${fieldProperty}": multi-value field`);
  }

  const targetColumnProperty = columnProperty
    ?? spec.fieldType.defaultSortColumn
    ?? "value";

  const column = spec.fieldType.columns.find(
    (entry) => columnNameToProperty(entry.name) === targetColumnProperty,
  );
  if (!column) {
    throw new Error(
      `Invalid property "${propertyPath}": unknown column "${targetColumnProperty}"`,
    );
  }

  return {
    tableAlias: fieldJoinAlias(spec),
    column: column.name,
  };
}

function isMultiValue(spec) {
  return spec.cardinality !== 1;
}

function isScalarFieldType(type) {
  return SCALAR_FIELD_TYPES.has(type);
}

/**
 * @param {object[]} columns field type column definitions
 * @param {(columnName: string) => unknown} getCell
 */
function fieldEntryFromRow(columns, getCell) {
  const entry = {};
  for (const column of columns) {
    entry[columnNameToProperty(column.name)] = getCell(column.name);
  }
  return entry;
}

function sqlColumnTypeToEntityType(sqlType) {
  switch (sqlType) {
    case "text":
      return "text";
    case "integer":
      return "integer";
    case "double precision":
      return "number";
    case "boolean":
      return "boolean";
    case "uuid":
      return "guid";
    default:
      throw new Error(`Unknown column type: ${sqlType}`);
  }
}

function parseColumnDefault(column) {
  if (column.default === undefined) {
    return undefined;
  }
  if (column.type === "integer") {
    return Number(column.default);
  }
  if (column.type === "boolean") {
    return column.default === "true" || column.default === true;
  }
  return column.default;
}

/**
 * @param {object} column field type column definition
 * @param {string} fieldLabel parent field label for error messages
 * @param {Record<string, typeof import("../entities/baseEntity").BaseEntity>} entityClasses
 */
function columnManifestToEntitySpec(column, fieldLabel, entityClasses) {
  const key = columnNameToProperty(column.name);
  const entitySpec = {
    key,
    label: `${fieldLabel}: ${key}`,
    required: column.nullable === false,
    type: sqlColumnTypeToEntityType(column.type),
  };

  const defaultValue = parseColumnDefault(column);
  if (defaultValue !== undefined) {
    entitySpec.default = defaultValue;
  }

  if (column.refs) {
    const EntityClass = entityClasses[column.refs];
    if (!EntityClass) {
      throw new Error(`Unknown entity ref "${column.refs}" for column "${column.name}"`);
    }
    entitySpec.refs = EntityClass;
  }

  return entitySpec;
}

/**
 * Convert a manifest field spec into an entity-layer field spec for coercion/validation.
 * @param {object} spec normalized manifest field spec
 * @param {Record<string, typeof import("../entities/baseEntity").BaseEntity>} entityClasses
 */
function manifestSpecToEntitySpec(spec, entityClasses) {
  const entitySpec = {
    label: spec.label,
    required: spec.required,
    cardinality: spec.cardinality,
    ...(spec.default !== undefined ? { default: spec.default } : {}),
    ...(spec.inputType ? { inputType: spec.inputType } : {}),
  };

  if (spec.type === "entityRef") {
    const EntityClass = entityClasses[spec.refs];
    if (!EntityClass) {
      throw new Error(`Unknown entity ref "${spec.refs}" for field "${spec.property}"`);
    }
    return { ...entitySpec, type: "guid", refs: EntityClass };
  }

  if (spec.type === "richText") {
    return { ...entitySpec, type: "text", inputType: "textarea" };
  }

  if (isScalarFieldType(spec.type)) {
    return { ...entitySpec, type: spec.type };
  }

  return {
    ...entitySpec,
    type: spec.type,
    structured: true,
    columns: spec.fieldType.columns.map((column) =>
      columnManifestToEntitySpec(column, spec.label, entityClasses),
    ),
  };
}

/**
 * @param {Record<string, object>} manifestSpecs
 * @returns {Promise<Record<string, object>>}
 */
async function buildEntityFieldSpecsFromManifest(manifestSpecs) {
  const entityClasses = await loadEntityClassesByKey();
  return Object.fromEntries(
    Object.entries(manifestSpecs).map(([property, spec]) => [
      property,
      manifestSpecToEntitySpec(spec, entityClasses),
    ]),
  );
}

/**
 * Add LEFT JOINs for single-value declared fields on a SELECT query.
 * @param {import("../services/queryService").QueryObject} query
 * @param {string} coreTableAlias
 * @param {Record<string, object>} manifestSpecs
 */
function addSingleValueFieldJoins(query, coreTableAlias, manifestSpecs, { onlyProperties, selectFields = true } = {}) {
  for (const [property, spec] of Object.entries(manifestSpecs)) {
    if (isMultiValue(spec)) {
      continue;
    }

    if (onlyProperties && !onlyProperties.has(property)) {
      continue;
    }

    const joinAlias = fieldJoinAlias(spec);
    query.addLeftJoin(spec.schema, spec.table, joinAlias,
      `${qualify(joinAlias, "entity_guid")} = ${qualify(coreTableAlias, "guid")} AND ${qualify(joinAlias, "delta")} = 0`,
    );

    if (selectFields) {
      for (const column of spec.fieldType.columns) {
        query.addFields(joinAlias, column.name, fieldSelectAlias(spec, column.name));
      }
    }
  }

  return query;
}

/**
 * @param {object} row
 * @param {Record<string, object>} manifestSpecs
 */
function singleValueFieldsFromRow(row, manifestSpecs) {
  const values = {};

  for (const [property, spec] of Object.entries(manifestSpecs)) {
    if (isMultiValue(spec)) {
      continue;
    }

    const entry = fieldEntryFromRow(spec.fieldType.columns, (columnName) =>
      row[fieldSelectAlias(spec, columnName)],
    );
    values[property] = isScalarFieldType(spec.type) ? entry.value : entry;
  }

  return values;
}

/**
 * Batch-load multi-value declared fields for a set of entity guids.
 * @param {(text: string, params?: unknown[]) => Promise<{ rows: object[] }>} queryFn
 * @param {string[]} entityGuids
 * @param {Record<string, object>} manifestSpecs
 * @returns {Promise<Record<string, Record<string, unknown[]>>>} entityGuid → property → values
 */
async function loadMultiValueFields(queryFn, entityGuids, manifestSpecs) {
  /** @type {Record<string, Record<string, unknown[]>>} */
  const byEntity = {};

  if (!entityGuids.length) {
    return byEntity;
  }

  for (const guid of entityGuids) {
    byEntity[guid] = {};
  }

  for (const [property, spec] of Object.entries(manifestSpecs)) {
    if (!isMultiValue(spec)) {
      continue;
    }

    const tableAlias = "t";
    const { columns } = spec.fieldType;
    const queryColumns = ["entity_guid", "delta", ...columns.map((column) => column.name)];
    const query = selectQuery()
      .from(spec.schema, spec.table, tableAlias)
      .addFields(tableAlias, queryColumns)
      .whereColumn(tableAlias, "entity_guid", entityGuids)
      .orderBy(tableAlias, "entity_guid")
      .orderBy(tableAlias, "delta");

    const result = await queryFn(query.toString(), query.params);

    for (const row of result.rows) {
      const entry = fieldEntryFromRow(columns, (columnName) => row[columnName]);
      const entityGuid = row.entity_guid;
      if (!byEntity[entityGuid][property]) {
        byEntity[entityGuid][property] = [];
      }
      byEntity[entityGuid][property].push(entry);
    }
  }

  return byEntity;
}

/**
 * Normalize an entity property value into an array of row payloads for persistence.
 * @param {unknown} rawValue
 * @param {object} spec manifest field spec
 * @returns {object[]}
 */
function normalizeValuesForSave(rawValue, spec) {
  if (isMultiValue(spec)) {
    if (rawValue == null) {
      return [];
    }
    if (!Array.isArray(rawValue)) {
      return null;
    }
    return rawValue.map((entry) => (entry && typeof entry === "object" ? entry : null));
  }

  if (rawValue == null || rawValue === "") {
    return [];
  }

  if (isScalarFieldType(spec.type)) {
    return [{ value: rawValue }];
  }

  if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
    return [rawValue];
  }

  return null;
}

/**
 * @param {object[]} values
 * @param {object} spec manifest field spec
 */
function validateValueCount(values, spec) {
  const { cardinality } = spec;

  if (cardinality < 1 || values.length <= cardinality) {
    return null;
  }
  return `${spec.label} allows at most ${cardinality} values`;
}

/**
 * @param {typeof import("../entities/baseEntity").BaseEntity} EntityClass
 * @param {string} value
 * @param {object} context
 */
async function entityExists(EntityClass, value, context) {
  const StorageClass = EntityClass.getStorage();
  const storage = StorageClass.instanceScoped === false
    ? StorageClass.global()
    : StorageClass.forInstance(context.instance);

  return storage.exists(value);
}

/**
 * @param {object[]} values
 * @param {object} entitySpec entity-layer field spec with `columns`
 * @param {object} context
 */
async function validateStructuredValues(values, entitySpec, context) {
  const { EntityFieldTypes } = require("../entities/baseEntity");
  const errors = [];

  for (const entry of values) {
    if (!entry || typeof entry !== "object") {
      errors.push(`${entitySpec.label} entries must be objects`);
      continue;
    }

    for (const columnSpec of entitySpec.columns) {
      const message = await EntityFieldTypes.validate(entry[columnSpec.key], columnSpec, context);
      if (message) {
        errors.push(message);
      }
    }
  }

  return errors;
}

/**
 * @param {unknown} rawValue
 * @param {object} spec manifest field spec
 * @param {object} context
 * @returns {Promise<string[]>}
 */
async function validateFieldValue(rawValue, spec, context) {
  const values = normalizeValuesForSave(rawValue, spec);
  if (values === null) {
    return [`${spec.label} has an invalid value`];
  }

  const countError = validateValueCount(values, spec);
  if (countError) {
    return [countError];
  }

  if (spec.required && !values.length) {
    return [`${spec.label} is required`];
  }

  const entityClasses = await loadEntityClassesByKey();

  if (spec.type === "entityRef") {
    const EntityClass = entityClasses[spec.refs];
    if (!EntityClass) {
      return [`${spec.label} references unknown entity "${spec.refs}"`];
    }

    for (const entry of values) {
      const refValue = entry.value;
      if (refValue == null || refValue === "") {
        if (spec.required) {
          return [`${spec.label} is required`];
        }
        continue;
      }

      const exists = await entityExists(EntityClass, refValue, context);
      if (!exists) {
        const scope = EntityClass.getStorage().instanceScoped === false ? "" : " for this instance";
        return [`${spec.label} not found${scope}`];
      }
    }

    return [];
  }

  if (isScalarFieldType(spec.type)) {
    const { EntityFieldTypes } = require("../entities/baseEntity");
    const entitySpec = manifestSpecToEntitySpec(spec, entityClasses);
    const errors = [];

    for (const entry of values) {
      const message = await EntityFieldTypes.validate(
        entry.value,
        { ...entitySpec, key: spec.property },
        context,
      );
      if (message) {
        errors.push(message);
      }
    }

    return errors;
  }

  return validateStructuredValues(values, manifestSpecToEntitySpec(spec, entityClasses), context);
}

/**
 * @param {import("../entities/baseEntity").BaseEntity} entity
 * @param {Record<string, object>} manifestSpecs
 * @param {object} context
 */
async function collectFieldValidationErrors(entity, manifestSpecs, context) {
  const messages = await Promise.all(
    Object.entries(manifestSpecs).map(([property, spec]) =>
      validateFieldValue(entity[property], spec, context),
    ),
  );

  return messages.flat();
}

/**
 * @param {(text: string, params?: unknown[]) => Promise<unknown>} queryFn
 * @param {string} entityGuid
 * @param {import("../entities/baseEntity").BaseEntity} entity
 * @param {Record<string, object>} manifestSpecs
 */
async function saveFieldValuesForEntity(queryFn, entityGuid, entity, manifestSpecs) {
  for (const [property, spec] of Object.entries(manifestSpecs)) {
    const values = normalizeValuesForSave(entity[property], spec);
    if (values === null) {
      throw new Error(`${spec.label} has an invalid value`);
    }

    const countError = validateValueCount(values, spec);
    if (countError) {
      throw new Error(countError);
    }

    const deleteQueryObj = deleteQuery()
      .from(spec.schema, spec.table, "t")
      .whereColumn("t", "entity_guid", entityGuid);

    await queryFn(deleteQueryObj.toString(), deleteQueryObj.params);

    if (!values.length) {
      continue;
    }

    for (let delta = 0; delta < values.length; delta += 1) {
      const entry = values[delta];
      const columns = ["entity_guid", "delta"];
      const rowValues = [entityGuid, delta];

      if (isScalarFieldType(spec.type)) {
        columns.push("value");
        rowValues.push(entry.value);
      } else {
        for (const column of spec.fieldType.columns) {
          columns.push(column.name);
          const propertyName = columnNameToProperty(column.name);
          rowValues.push(entry[propertyName] ?? null);
        }
      }

      const insert = insertQuery()
        .into(spec.schema, spec.table)
        .values(columns, rowValues);

      await queryFn(insert.toString(), insert.params);
    }
  }
}

module.exports = {
  buildEntityFieldSpecsFromManifest,
  addSingleValueFieldJoins,
  singleValueFieldsFromRow,
  loadMultiValueFields,
  saveFieldValuesForEntity,
  collectFieldValidationErrors,
  resolvePropertyPath,
};
