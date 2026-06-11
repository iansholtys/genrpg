const { mergeExtensionFieldSpecs } = require("./entityExtensionIndex");
const { ValidationError } = require("../errors/ValidationError");
const { pool } = require("../db/pool");
const { getTransactionClient } = require("../db/transactionContext");
const { quoteColumn, selectQuery, insertQuery, updateQuery } = require("../services/queryService");

async function metadataQuery(text, params = []) {
  const executor = getTransactionClient() || pool;
  return executor.query(text, params);
}

function extensionRowAlias(spec) {
  return `${spec.schema}_${spec.column}`;
}

async function loadExtensionSchemas(coreSchema, coreTable, parentKeyColumn, packageNames) {
  const schemas = [...new Set([coreSchema, ...packageNames])];
  const invalidSchema = schemas.find((schema) => !/^[a-z][a-z0-9_]*$/.test(schema));
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
    [schemas, parentKeyColumn, coreTable],
  );

  const found = result.rows.map((row) => ({
    schema: row.table_schema,
    hasParentKey: row.has_parent_key,
  }));

  if (!found.some((row) => row.schema === coreSchema)) {
    throw new Error(`Core ${coreSchema}.${coreTable} table does not exist`);
  }

  return found.filter((row) => row.schema === coreSchema || row.hasParentKey);
}

async function loadExtensionColumns(coreTable, schemas) {
  const tableAlias = "c";
  const query = selectQuery()
    .from("information_schema", "columns", tableAlias)
    .addFields(tableAlias, [
      "table_schema",
      "column_name",
      "column_default",
      "is_nullable",
      "data_type",
      "udt_name",
    ])
    .whereColumn(tableAlias, "table_schema", schemas)
    .whereColumn(tableAlias, "table_name", coreTable)
    .orderBy(tableAlias, "table_schema")
    .orderBy(tableAlias, "ordinal_position");

  const result = await metadataQuery(query.toString(), query.params);

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
async function buildExtensionFieldSpecs(StorageClass, packageNames, coreFieldKeys = []) {
  const { schema: coreSchema, table: coreTable } = StorageClass;
  const entityKey = StorageClass.Entity.key;
  const parentKeyColumn = `${entityKey}_guid`;
  const merged = mergeExtensionFieldSpecs(entityKey, packageNames, coreFieldKeys);
  if (!Object.keys(merged).length) {
    return {};
  }

  const schemaRows = await loadExtensionSchemas(coreSchema, coreTable, parentKeyColumn, packageNames);
  const activeSchemas = new Set(
    schemaRows
      .map((row) => row.schema)
      .filter((schema) => schema !== coreSchema),
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
  const columnsBySchema = await loadExtensionColumns(coreTable, packageSchemas);

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

  for (const [property, spec] of Object.entries(extensionFieldSpecs)) {
    if (!Object.prototype.hasOwnProperty.call(entity, property)) {
      continue;
    }

    const value = entity[property];
    if (value === null || value === undefined || value === "") {
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
  if (!columns.length) {
    throw new Error(`No values supplied for ${schema}.${table}`);
  }

  const query = insertQuery()
    .into(schema, table)
    .values(columns, columns.map((column) => values[column]));

  return {
    sql: query.toString(),
    params: query.params,
  };
}

function buildUpdateQuery(schema, table, values, whereColumnName, whereValue) {
  const columns = Object.keys(values);
  if (!columns.length) {
    return null;
  }

  const query = updateQuery()
    .from(schema, table, null)
    .set(columns, columns.map((column) => values[column]))
    .whereExpression(quoteColumn(whereColumnName), whereValue);

  return {
    sql: query.toString(),
    params: query.params,
  };
}

async function saveExtensionRows(StorageClass, packageNames, parentGuid, entity, queryFn) {
  const { schema: coreSchema, table: coreTable } = StorageClass;
  const parentKeyColumn = `${StorageClass.Entity.key}_guid`;
  const extensionFieldSpecs = entity.extensionFieldSpecs || {};
  if (!Object.keys(extensionFieldSpecs).length) {
    return;
  }

  const valuesBySchema = collectExtensionValues(entity, extensionFieldSpecs);
  if (!valuesBySchema.size) {
    return;
  }

  const schemaRows = await loadExtensionSchemas(coreSchema, coreTable, parentKeyColumn, packageNames);
  const activeSchemas = new Set(
    schemaRows
      .map((row) => row.schema)
      .filter((schema) => schema !== coreSchema),
  );

  for (const [schema, columnValues] of valuesBySchema) {
    if (!Object.keys(columnValues).length) {
      continue;
    }

    if (!activeSchemas.has(schema)) {
      const columnAlias = "c";
      const columnQuery = selectQuery()
        .from("information_schema", "columns", columnAlias)
        .addFields(columnAlias, "column_name")
        .whereColumn(columnAlias, "table_schema", schema)
        .whereColumn(columnAlias, "table_name", coreTable)
        .orderBy(columnAlias, "ordinal_position");

      const columnResult = await metadataQuery(columnQuery.toString(), columnQuery.params);
      const columnsFound = columnResult.rows.map((row) => row.column_name).join(", ") || "(table missing)";
      const tableAlias = "p";
      const versionQuery = selectQuery()
        .from("genrpg", "packages", tableAlias)
        .addFields(tableAlias, "version")
        .whereColumn(tableAlias, "package", schema);

      const versionResult = await metadataQuery(versionQuery.toString(), versionQuery.params);
      const packageDbVersion = versionResult.rows[0]?.version ?? "not recorded";

      throw new ValidationError([
        `Cannot save package fields for "${schema}": ${schema}.${coreTable} must exist with column ${parentKeyColumn}.`,
        `Update the "${schema}" package from Manage Packages (pull or Update packages). Package DB version: ${packageDbVersion}.`,
        `Columns found on ${schema}.${coreTable}: ${columnsFound}.`,
      ]);
    }

    const packageUpdate = buildUpdateQuery(
      schema,
      coreTable,
      columnValues,
      parentKeyColumn,
      parentGuid,
    );
    const updateResult = await queryFn(packageUpdate.sql, packageUpdate.params);

    if (updateResult.rowCount === 0) {
      const insertValues = {
        [parentKeyColumn]: parentGuid,
        ...columnValues,
      };
      const packageInsert = buildInsertQuery(schema, coreTable, insertValues);
      await queryFn(packageInsert.sql, packageInsert.params);
    }
  }
}

module.exports = {
  buildExtensionFieldSpecs,
  saveExtensionRows,
  extensionRowAlias,
  loadExtensionSchemas,
};
