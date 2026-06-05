const { mergeExtensionFieldSpecs } = require("./entityExtensionIndex");
const { pool } = require("../db/pool");
const { getTransactionClient } = require("../db/transactionContext");

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

const ENTITY_EXTENSION_CONFIGS = {
  item: {
    coreSchema: "genrpg",
    coreTable: "items",
    parentKeyColumn: "item_guid",
    managedColumns: new Set([
      "guid",
      "item_guid",
      "instance_guid",
      "create_datetime",
      "update_datetime",
    ]),
  },
};

function quoteIdentifier(identifier) {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid database identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function quoteColumn(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid database column: ${identifier}`);
  }

  return `"${identifier}"`;
}

function isNonEmptyValue(value) {
  return value !== null && value !== undefined && value !== "";
}

async function metadataQuery(text, params = []) {
  const executor = getTransactionClient() || pool;
  return executor.query(text, params);
}

function getExtensionConfig(entityKey) {
  const config = ENTITY_EXTENSION_CONFIGS[entityKey];
  if (!config) {
    throw new Error(`Unknown extension entity key: ${entityKey}`);
  }
  return config;
}

async function loadExtensionSchemas(config, packageNames) {
  const schemas = [...new Set([config.coreSchema, ...packageNames])];
  const invalidSchema = schemas.find((schema) => !IDENTIFIER_PATTERN.test(schema));
  if (invalidSchema) {
    throw new Error(`Invalid package schema name: ${invalidSchema}`);
  }

  const result = await metadataQuery(
    `
      SELECT t.table_schema,
        EXISTS (
          SELECT 1
          FROM information_schema.columns c
          WHERE c.table_schema = t.table_schema
            AND c.table_name = t.table_name
            AND c.column_name = $2
        ) AS has_parent_key
      FROM information_schema.tables t
      WHERE t.table_schema = ANY($1::text[])
        AND t.table_name = $3
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_schema ASC
    `,
    [schemas, config.parentKeyColumn, config.coreTable],
  );

  const found = result.rows.map((row) => ({
    schema: row.table_schema,
    hasParentKey: row.has_parent_key,
  }));

  if (!found.some((row) => row.schema === config.coreSchema)) {
    throw new Error(`Core ${config.coreSchema}.${config.coreTable} table does not exist`);
  }

  return found.filter((row) => row.schema === config.coreSchema || row.hasParentKey);
}

async function loadExtensionColumns(config, schemas) {
  const result = await metadataQuery(
    `
      SELECT
        table_schema,
        column_name,
        column_default,
        is_nullable,
        data_type,
        udt_name
      FROM information_schema.columns
      WHERE table_schema = ANY($1::text[])
        AND table_name = $2
      ORDER BY table_schema ASC, ordinal_position ASC
    `,
    [schemas, config.coreTable],
  );

  const columnsBySchema = new Map();
  for (const row of result.rows) {
    if (!columnsBySchema.has(row.table_schema)) {
      columnsBySchema.set(row.table_schema, []);
    }
    columnsBySchema.get(row.table_schema).push({
      name: row.column_name,
      hasDefault: row.column_default !== null,
      nullable: row.is_nullable === "YES",
      required: row.is_nullable === "NO" && row.column_default === null,
      dataType: row.data_type === "USER-DEFINED" ? row.udt_name : row.data_type,
    });
  }

  return columnsBySchema;
}

/**
 * Build runtime field specs from package entity extension modules, verified against the database.
 * Specs are keyed by entity property name (camelCase).
 */
async function buildExtensionFieldSpecs(entityKey, packageNames, coreFieldKeys = []) {
  const config = getExtensionConfig(entityKey);
  const merged = mergeExtensionFieldSpecs(entityKey, packageNames, coreFieldKeys);
  if (!Object.keys(merged).length) {
    return {};
  }

  const schemaRows = await loadExtensionSchemas(config, packageNames);
  const activeSchemas = new Set(
    schemaRows
      .map((row) => row.schema)
      .filter((schema) => schema !== config.coreSchema),
  );

  const specs = {};
  for (const [property, spec] of Object.entries(merged)) {
    if (activeSchemas.has(spec.schema)) {
      specs[property] = spec;
    }
  }

  if (!Object.keys(specs).length) {
    return {};
  }

  const packageSchemas = [...new Set(Object.values(specs).map((spec) => spec.schema))];
  const columnsBySchema = await loadExtensionColumns(config, packageSchemas);

  for (const spec of Object.values(specs)) {
    const columnNames = new Set(
      (columnsBySchema.get(spec.schema) || []).map((column) => column.name),
    );
    if (!columnNames.has(spec.column)) {
      throw new Error(
        `Extension field "${spec.property}" (${spec.schema}) references column "${spec.column}" which does not exist in the database`,
      );
    }
  }

  return specs;
}

function collectExtensionValues(entity, extensionFieldSpecs) {
  const valuesBySchema = new Map();

  for (const spec of Object.values(extensionFieldSpecs)) {
    if (!(spec.property in entity)) {
      continue;
    }

    const value = entity[spec.property];
    if (!isNonEmptyValue(value)) {
      continue;
    }

    if (!valuesBySchema.has(spec.schema)) {
      valuesBySchema.set(spec.schema, {});
    }
    valuesBySchema.get(spec.schema)[spec.column] = value;
  }

  return valuesBySchema;
}

function buildInsertQuery(schema, table, values) {
  const columns = Object.keys(values);
  const columnSql = columns.map(quoteColumn).join(", ");
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  return {
    sql: `INSERT INTO ${quoteIdentifier(schema)}.${quoteIdentifier(table)} (${columnSql}) VALUES (${placeholders})`,
    params: columns.map((column) => values[column]),
  };
}

function buildUpdateQuery(schema, table, values, whereColumn, whereValue) {
  const columns = Object.keys(values);
  if (!columns.length) {
    return null;
  }

  const setSql = columns.map((column, index) => `${quoteColumn(column)} = $${index + 1}`).join(", ");
  const params = columns.map((column) => values[column]);
  params.push(whereValue);

  return {
    sql: `
      UPDATE ${quoteIdentifier(schema)}.${quoteIdentifier(table)}
      SET ${setSql}
      WHERE ${quoteColumn(whereColumn)} = $${columns.length + 1}
    `,
    params,
  };
}

async function saveExtensionRows(entityKey, packageNames, parentGuid, entity, queryFn) {
  const config = getExtensionConfig(entityKey);
  const extensionFieldSpecs = entity.extensionFieldSpecs || {};
  if (!Object.keys(extensionFieldSpecs).length) {
    return;
  }

  const valuesBySchema = collectExtensionValues(entity, extensionFieldSpecs);
  if (!valuesBySchema.size) {
    return;
  }

  const schemaRows = await loadExtensionSchemas(config, packageNames);
  const schemas = schemaRows
    .map((row) => row.schema)
    .filter((schema) => schema !== config.coreSchema);
  const columnsBySchema = await loadExtensionColumns(config, schemas);

  for (const schema of schemas) {
    const columnValues = valuesBySchema.get(schema);
    if (!columnValues || !Object.keys(columnValues).length) {
      continue;
    }

    const packageUpdate = buildUpdateQuery(
      schema,
      config.coreTable,
      columnValues,
      config.parentKeyColumn,
      parentGuid,
    );
    const updateResult = await queryFn(packageUpdate.sql, packageUpdate.params);

    if (updateResult.rowCount === 0) {
      const columns = columnsBySchema.get(schema) || [];
      const guidColumn = columns.find((column) => column.name === "guid");
      const insertValues = { [config.parentKeyColumn]: parentGuid, ...columnValues };
      if (guidColumn?.required && !guidColumn.hasDefault) {
        const crypto = require("node:crypto");
        insertValues.guid = crypto.randomUUID();
      }
      const packageInsert = buildInsertQuery(schema, config.coreTable, insertValues);
      await queryFn(packageInsert.sql, packageInsert.params);
    }
  }
}

async function deleteExtensionRows(entityKey, packageNames, parentGuid, queryFn) {
  const config = getExtensionConfig(entityKey);
  const schemaRows = await loadExtensionSchemas(config, packageNames);
  const schemas = schemaRows
    .map((row) => row.schema)
    .filter((schema) => schema !== config.coreSchema);

  for (const schema of schemas) {
    await queryFn(
      `
        DELETE FROM ${quoteIdentifier(schema)}.${quoteIdentifier(config.coreTable)}
        WHERE ${quoteColumn(config.parentKeyColumn)} = $1
      `,
      [parentGuid],
    );
  }
}

async function buildExtensionJoinSql(entityKey, packageNames, coreTableAlias) {
  const config = getExtensionConfig(entityKey);
  const schemaRows = await loadExtensionSchemas(config, packageNames);
  const schemas = schemaRows
    .map((row) => row.schema)
    .filter((schema) => schema !== config.coreSchema);

  const joins = [];
  const jsonParts = [];

  for (const [index, schema] of schemas.entries()) {
    const alias = `ext${index + 1}`;
    joins.push(
      `LEFT JOIN ${quoteIdentifier(schema)}.${quoteIdentifier(config.coreTable)} ${alias} ON ${alias}.${quoteColumn(config.parentKeyColumn)} = ${coreTableAlias}.guid`,
    );
    jsonParts.push(
      `'${schema}', CASE WHEN ${alias}.${quoteColumn(config.parentKeyColumn)} IS NULL THEN NULL ELSE row_to_json(${alias}) END`,
    );
  }

  const packageExtensionsSql = jsonParts.length
    ? `json_build_object(${jsonParts.join(", ")})`
    : `'{}'::json`;

  return { joins, packageExtensionsSql };
}

function packageDataFromRow(packageExtensions) {
  if (!packageExtensions || typeof packageExtensions !== "object") {
    return {};
  }

  const packageData = {};
  for (const [schema, row] of Object.entries(packageExtensions)) {
    if (!row || typeof row !== "object") {
      continue;
    }
    packageData[schema] = row;
  }
  return packageData;
}

function flattenPackageDataForEntity(packageData, extensionFieldSpecs) {
  const values = {};
  for (const spec of Object.values(extensionFieldSpecs)) {
    const raw = packageData[spec.schema]?.[spec.column];
    if (raw !== undefined) {
      values[spec.property] = raw;
    }
  }
  return values;
}

module.exports = {
  buildExtensionFieldSpecs,
  buildExtensionJoinSql,
  saveExtensionRows,
  deleteExtensionRows,
  packageDataFromRow,
  flattenPackageDataForEntity,
};
