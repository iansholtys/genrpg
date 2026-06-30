/**
 * Quote a schema, table, or alias identifier for safe SQL interpolation.
 *
 * @param {string} identifier
 */
function quoteIdentifier(identifier) {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid database identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

/**
 * Quote a column name for safe SQL interpolation.
 *
 * @param {string} identifier
 */
function quoteColumn(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid database column: ${identifier}`);
  }

  return `"${identifier}"`;
}

/**
 * Fluent builder for PostgreSQL SELECT, INSERT, UPDATE, DELETE, CREATE TABLE, and ALTER TABLE queries.
 *
 * Call the query builders ({@link selectQuery}, {@link insertQuery}, {@link updateQuery},
 * {@link deleteQuery}, {@link createTableQuery}, {@link alterTableQuery}) to obtain a
 * {@link QueryObject}, chain configuration methods, then pass {@link QueryObject#toString toString()}
 * and {@link QueryObject#params params} to pg. Use {@link createSchemaQuery} for schema DDL,
 * {@link createUpdateFunctionQuery} and {@link createBeforeUpdateTriggerQuery} for trigger DDL.
 * This module only builds SQL strings; it does not execute them.
 */

/** Wrap a single value in a one-element array for field/alias handling. */
function normalizeToArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return [value];
}

/**
 * Returns `"tableAlias"."column"` with identifiers quoted for safe SQL interpolation.
 * Use for join ON clauses and other raw fragments; prefer {@link QueryObject#whereColumn}
 * for simple WHERE comparisons on a qualified column.
 *
 * @param {string} tableAlias
 * @param {string} column
 */
function qualify(tableAlias, column) {
  return `${quoteIdentifier(tableAlias)}.${quoteColumn(column)}`;
}

/**
 * Returns `"schema"."table"` with identifiers quoted for safe SQL interpolation.
 *
 * @param {string} schema
 * @param {string} table
 */
function qualifyTable(schema, table) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

/** Format one SELECT list entry as `"alias"."field"` or `"alias"."field" AS "name"`. */
function formatField(tableAlias, field, alias) {
  const part = qualify(tableAlias, field);

  if (alias !== undefined && alias !== null && alias !== "") {
    return `${part} AS ${quoteIdentifier(alias)}`;
  }

  return part;
}

/** Renumber `$1`, `$2`, … placeholders in a clause to continue a running parameter offset. */
function renumberPlaceholders(expression, startIndex) {
  return expression.replace(/\$(\d+)/g, (_, number) => `$${startIndex + Number(number) - 1}`);
}

/**
 * Builds a SELECT, INSERT, UPDATE, DELETE, CREATE TABLE, or ALTER TABLE query through a chainable API.
 */
class QueryObject {
  constructor(queryType = "SELECT") {
    this._queryType = queryType;
    this._fieldGroups = [];
    this._expressions = [];
    this._from = null;
    this._joins = [];
    this._insertColumnNames = [];
    this._insertValues = [];
    this._onConflict = null;
    this._setClauses = [];
    this._whereClauses = [];
    this._params = [];
    this._orderByClauses = [];
    this._limit = null;
    this._returning = null;
    this._ifNotExists = false;
    this._alterIfNotExists = false;
    this._columns = [];
    this._tableConstraints = [];
  }

  /**
   * @param {"SELECT"|"INSERT"|"UPDATE"|"DELETE"|("SELECT"|"INSERT"|"UPDATE"|"DELETE")[]} queryType
   * @param {string} methodName
   */
  _requireType(queryType, methodName) {
    const allowed = Array.isArray(queryType) ? queryType : [queryType];
    if (!allowed.includes(this._queryType)) {
      throw new Error(`${methodName}() is only valid on ${allowed.join(" or ")} queries`);
    }
  }

  /**
   * Set the query's primary FROM table.
   *
   * @param {string} schema
   * @param {string} table
   * @param {string|null} [tableAlias] alias used in SELECT fields and WHERE/ORDER BY references
   */
  from(schema, table, tableAlias) {
    this._from = { schema, table, tableAlias };
    return this;
  }

  /**
   * Set the INSERT target table. Alias for {@link QueryObject#from} on INSERT queries.
   *
   * @param {string} schema
   * @param {string} table
   * @param {string|null} [tableAlias]
   */
  into(schema, table, tableAlias) {
    this._requireType("INSERT", "into");
    return this.from(schema, table, tableAlias);
  }

  /**
   * Set the CREATE TABLE or ALTER TABLE target. Alias for {@link QueryObject#from}.
   *
   * @param {string} schema
   * @param {string} table
   */
  table(schema, table) {
    this._requireType(["CREATE TABLE", "ALTER TABLE"], "table");
    return this.from(schema, table, null);
  }

  /**
   * Add IF NOT EXISTS to CREATE TABLE.
   */
  ifNotExists() {
    this._requireType("CREATE TABLE", "ifNotExists");
    this._ifNotExists = true;
    return this;
  }

  /**
   * Use ADD COLUMN IF NOT EXISTS when rendering an ALTER TABLE query.
   */
  addColumnIfNotExists() {
    this._requireType("ALTER TABLE", "addColumnIfNotExists");
    this._alterIfNotExists = true;
    return this;
  }

  /**
   * Record a column for CREATE TABLE or ALTER TABLE ADD COLUMN.
   *
   * @param {string} name
   * @param {{ type: string, nullable?: boolean, default?: string }} spec
   */
  addColumn(name, spec) {
    this._requireType(["CREATE TABLE", "ALTER TABLE"], "addColumn");
    this._columns.push({
      name,
      type: spec.type,
      nullable: spec.nullable !== false,
      default: spec.default,
    });
    return this;
  }

  /**
   * Record a PRIMARY KEY constraint for CREATE TABLE.
   *
   * @param {string|string[]} columns
   */
  primaryKey(columns) {
    this._requireType("CREATE TABLE", "primaryKey");
    this._tableConstraints.push({
      type: "primaryKey",
      columns: normalizeToArray(columns),
    });
    return this;
  }

  /**
   * Record a FOREIGN KEY constraint for CREATE TABLE.
   *
   * @param {string} constraintName
   * @param {string} column local column name
   * @param {string} refSchema referenced table schema
   * @param {string} refTable referenced table name
   * @param {string} [refColumn] referenced column name (defaults to guid)
   * @param {{ onDelete?: string }} [options]
   */
  foreignKey(constraintName, column, refSchema, refTable, refColumn = "guid", options = {}) {
    this._requireType("CREATE TABLE", "foreignKey");
    this._tableConstraints.push({
      type: "foreignKey",
      constraintName,
      column,
      refSchema,
      refTable,
      refColumn,
      onDelete: options.onDelete,
    });
    return this;
  }

  /**
   * Add quoted columns from a table to the SELECT list.
   *
   * @param {string} tableAlias
   * @param {string|string[]} fields column names on the joined table
   * @param {string|string[]} [aliases] optional output names (AS); maps to fields in order
   */
  addFields(tableAlias, fields, aliases) {
    this._requireType("SELECT", "addFields");
    this._fieldGroups.push({
      tableAlias,
      fields: normalizeToArray(fields),
      aliases: aliases !== undefined ? normalizeToArray(aliases) : undefined,
    });
    return this;
  }

  /**
   * Add a raw SQL expression to the SELECT list.
   *
   * @param {string} expression raw SQL for the SELECT list; caller must quote identifiers
   * @param {string} [alias] optional output column name
   */
  addExpression(expression, alias) {
    this._requireType("SELECT", "addExpression");
    this._expressions.push({ expression, alias });
    return this;
  }

  /** Record one JOIN clause (used by {@link QueryObject#addJoin} and {@link QueryObject#addLeftJoin}). */
  _addJoin(type, schema, table, tableAlias, joinCondition) {
    this._requireType("SELECT", "addJoin");
    this._joins.push({
      type,
      schema,
      table,
      tableAlias,
      joinCondition,
    });
    return this;
  }

  /**
   * Add an INNER JOIN.
   *
   * @param {string} schema
   * @param {string} table
   * @param {string|null} tableAlias pass `null` when the joined table has no alias
   * @param {string} joinCondition raw SQL for the ON clause; use {@link qualify} for column refs
   */
  addJoin(schema, table, tableAlias, joinCondition) {
    return this._addJoin("INNER", schema, table, tableAlias, joinCondition);
  }

  /** Add a LEFT JOIN. @see {@link QueryObject#addJoin} */
  addLeftJoin(schema, table, tableAlias, joinCondition) {
    return this._addJoin("LEFT", schema, table, tableAlias, joinCondition);
  }

  /**
   * Append a raw WHERE fragment. Placeholders start at `$1` per clause; renumbered in
   * {@link QueryObject#toString toString()}. Prefer {@link QueryObject#whereColumn} or
   * {@link QueryObject#whereExpression} for simple comparisons.
   *
   * @param {string} expression SQL after WHERE; caller must quote identifiers
   * @param {unknown[]} [args] bound parameter values
   */
  where(expression, args = []) {
    this._whereClauses.push({
      expression,
      args,
    });
    return this;
  }

  /** Build SQL and args for {@link QueryObject#whereColumn} and {@link QueryObject#whereExpression}. */
  _whereComparison(leftSql, comparison, value) {
    let operator = comparison.trim().toUpperCase();
    const isArray = Array.isArray(value);

    if (operator === "=" && isArray) {
      operator = "IN";
    }

    let expression;
    let args;

    switch (operator) {
      case "=":
      case ">":
      case "<":
      case ">=":
      case "<=":
      case "!=":
      case "<>":
        expression = `${leftSql} ${operator} $1`;
        args = [value];
        break;
      case "LIKE":
        expression = `${leftSql} LIKE $1`;
        args = [value];
        break;
      case "ANY":
      case "IN":
        if (!isArray) {
          throw new Error("IN comparison requires an array value");
        }
        expression = `${leftSql} = ANY($1)`;
        args = [value];
        break;
      case "BETWEEN":
        if (!isArray || value.length !== 2) {
          throw new Error("BETWEEN comparison requires a two-item array value");
        }
        expression = `${leftSql} BETWEEN $1 AND $2`;
        args = value;
        break;
      default:
        throw new Error(`Unsupported where comparison: ${comparison}`);
    }

    return this.where(expression, args);
  }

  /**
   * WHERE on a qualified column. Comparison is the last argument (defaults to `"="`).
   * When comparison is `"="` and `value` is an array, uses `IN` (`= ANY($1)`).
   *
   * Supported comparisons: `=`, `>`, `<`, `>=`, `<=`, `!=`, `<>`, `LIKE`, `IN`, `ANY`, `BETWEEN`.
   * `BETWEEN` expects `value` as a two-item array.
   *
   * @param {string} tableAlias
   * @param {string} column
   * @param {unknown} value
   * @param {string} [comparison]
   */
  whereColumn(tableAlias, column, value, comparison = "=") {
    return this._whereComparison(qualify(tableAlias, column), comparison, value);
  }

  /**
   * WHERE on a raw left-hand expression. Same comparison rules as {@link QueryObject#whereColumn}.
   *
   * @param {string} expression SQL for the column side; caller must quote identifiers
   * @param {unknown} value
   * @param {string} [comparison]
   */
  whereExpression(expression, value, comparison = "=") {
    return this._whereComparison(expression, comparison, value);
  }

  /**
   * Set INSERT column names and optionally add one or more rows.
   *
   * `columns` may be a string or array. Each subsequent argument is one row of bound values
   * (string or array); row length must match the column count. May be called only once.
   * Use {@link QueryObject#addRows} to append more rows afterward.
   *
   * @param {string|string[]} columns
   * @param {...unknown|unknown[]} rowSets
   */
  values(columns, ...rowSets) {
    this._requireType("INSERT", "values");

    if (this._insertColumnNames.length > 0) {
      throw new Error("values() columns can only be set once");
    }

    this._insertColumnNames = normalizeToArray(columns);

    if (rowSets.length > 0) {
      this.addRows(...rowSets);
    }

    return this;
  }

  /**
   * Append one or more INSERT rows. Each row may be a string or array; length must match
   * the column count set by {@link QueryObject#values}. May be called more than once.
   *
   * @param {...unknown|unknown[]} rows
   */
  addRows(...rows) {
    this._requireType("INSERT", "addRows");

    if (!this._insertColumnNames.length) {
      throw new Error("addRows() requires columns to be set via values() first");
    }

    const columnCount = this._insertColumnNames.length;

    for (const row of rows) {
      const boundValues = normalizeToArray(row);

      if (boundValues.length !== columnCount) {
        throw new Error(
          `addRows() row length ${boundValues.length} does not match column count ${columnCount}`,
        );
      }

      this._insertValues.push(boundValues);
    }

    return this;
  }

  /**
   * Add an ON CONFLICT clause (INSERT only).
   *
   * `targets` names the unique constraint column(s). Pass an empty array when PostgreSQL
   * should infer the constraint from any unique violation. Supported actions:
   * - `"DO NOTHING"`
   * - `"DO UPDATE"` — sets each inserted column not in `targets` to `"column" = EXCLUDED."column"`
   *
   * @param {string|string[]} targets
   * @param {string} action
   */
  onConflict(targets, action) {
    this._requireType("INSERT", "onConflict");

    const normalized = action.trim().toUpperCase().replace(/\s+/g, " ");
    if (normalized !== "DO NOTHING" && normalized !== "DO UPDATE") {
      throw new Error(`Unsupported onConflict action: ${action}`);
    }

    this._onConflict = {
      targets: normalizeToArray(targets),
      action: normalized,
    };
    return this;
  }

  /**
   * Add SET assignments for an UPDATE from column names and bound values.
   *
   * `columns` and `values` may be strings or arrays (mapped in order; lengths must match).
   * Each value becomes one `$n` param.
   *
   * @param {string|string[]} columns
   * @param {unknown|unknown[]} values
   */
  set(columns, values) {
    this._requireType("UPDATE", "set");

    const columnNames = normalizeToArray(columns);
    const columnValues = normalizeToArray(values);

    if (columnNames.length !== columnValues.length) {
      throw new Error("set() columns and values must be the same length");
    }

    for (let index = 0; index < columnNames.length; index += 1) {
      // PostgreSQL UPDATE SET targets must not be table-qualified (alias or name).
      this._setClauses.push({
        expression: `${quoteColumn(columnNames[index])} = $1`,
        args: [columnValues[index]],
      });
    }

    return this;
  }

  /**
   * Add a raw SET assignment fragment for an UPDATE.
   *
   * Pass a full assignment including `=` and local `$1`, `$2`, … placeholders; `args` supplies
   * bound values. Caller must quote identifiers in `expression`.
   *
   * @param {string} expression
   * @param {unknown[]} [args]
   */
  setExpression(expression, args = []) {
    this._requireType("UPDATE", "setExpression");

    this._setClauses.push({
      expression,
      args,
    });
    return this;
  }

  /**
   * Append one sort key to ORDER BY.
   *
   * Arguments are fixed-order; use `null` as `tableAlias` for expression sorts (pass the
   * full expression as `column`, including functions such as COALESCE).
   *
   * @param {string|null} tableAlias `null` for expression sorts; otherwise the table alias
   * @param {string} column column name, or a full SQL expression when `tableAlias` is null
   * @param {string} [direction] `ASC` or `DESC`
   * @param {string|null} [nullsOrdering] `NULLS FIRST` or `NULLS LAST`; omit for default null ordering
   */
  orderBy(tableAlias, column, direction = "ASC", nullsOrdering = null) {
    this._requireType("SELECT", "orderBy");
    if (!column) {
      throw new Error("orderBy requires a column or expression");
    }

    const clause = {};
    clause.direction = (direction ?? "ASC").trim().toUpperCase();
    if (!["ASC", "DESC"].includes(clause.direction)) {
      throw new Error(`Invalid order direction: ${direction}`);
    }

    clause.nullsOrdering = nullsOrdering?.trim().toUpperCase().replace(/\s+/g, " ") ?? null;
    if (clause.nullsOrdering && !["NULLS FIRST", "NULLS LAST"].includes(clause.nullsOrdering)) {
      throw new Error(`Invalid nulls ordering: ${nullsOrdering}`);
    }

    if (!tableAlias) {
      clause.expression = column;
    } else {
      clause.tableAlias = tableAlias;
      clause.column = column;
    }
    this._orderByClauses.push(clause);

    return this;
  }

  /**
   * Limit the number of rows returned (SELECT only). Value is inlined as a literal, not a bound param.
   *
   * @param {number} count non-negative integer
   */
  limit(count) {
    this._requireType("SELECT", "limit");
    const limit = Number(count);
    if (!Number.isInteger(limit) || limit < 0) {
      throw new Error("limit() requires a non-negative integer");
    }

    this._limit = limit;
    return this;
  }

  /**
   * Add a RETURNING clause (INSERT, UPDATE, or DELETE).
   *
   * @param {string|null} tableAlias pass `null` on INSERT for unqualified column names
   * @param {string|string[]} fields column names to return
   */
  returning(tableAlias, fields) {
    this._requireType(["INSERT", "UPDATE", "DELETE"], "returning");

    this._returning = {
      tableAlias,
      fields: normalizeToArray(fields),
    };
    return this;
  }

  /** Render the SELECT column list (without the `SELECT` keyword). */
  formatSelect() {
    const selectParts = [];

    for (const group of this._fieldGroups) {
      const aliases = group.aliases ?? [];

      for (let index = 0; index < group.fields.length; index += 1) {
        const alias = index in aliases ? aliases[index] : undefined;
        selectParts.push(formatField(group.tableAlias, group.fields[index], alias));
      }
    }

    for (const { expression, alias } of this._expressions) {
      if (alias !== undefined && alias !== null && alias !== "") {
        selectParts.push(`${expression} AS ${quoteIdentifier(alias)}`);
      } else {
        selectParts.push(expression);
      }
    }

    return selectParts.join(", ");
  }

  /** Render `"schema"."table"` and optional table alias (without the `FROM` keyword). */
  formatFrom() {
    const { schema, table, tableAlias } = this._from;
    let sql = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

    if (tableAlias) {
      sql += ` ${quoteIdentifier(tableAlias)}`;
    }

    return sql;
  }

  /** Render all JOIN lines, or an empty array when there are none. */
  formatJoins() {
    return this._joins.map(({ type = "INNER", schema, table, tableAlias, joinCondition }) => {
      const joinKeyword = type === "LEFT" ? "LEFT JOIN" : "JOIN";
      let sql = `${joinKeyword} ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

      if (tableAlias) {
        sql += ` ${quoteIdentifier(tableAlias)}`;
      }

      sql += ` ON ${joinCondition}`;
      return sql;
    });
  }

  /** Clear bound parameters before {@link QueryObject#formatSet} / {@link QueryObject#formatWhere}. */
  _resetParams() {
    this._params = [];
  }

  /**
   * Renumber clause expressions and append bound values to {@link QueryObject#params}.
   *
   * @param {{ expression: string, args: unknown[] }[]} clauses
   * @returns {string[]}
   */
  _formatClauseGroup(clauses) {
    const parts = [];
    let offset = this._params.length + 1;

    for (const clause of clauses) {
      parts.push(renumberPlaceholders(clause.expression, offset));
      this._params.push(...clause.args);
      offset += clause.args.length;
    }

    return parts;
  }

  /** Render quoted INSERT column list (without parentheses), or null when empty. */
  formatColumns() {
    if (!this._insertColumnNames.length) {
      return null;
    }

    return this._insertColumnNames.map(quoteColumn).join(", ");
  }

  /**
   * Render INSERT VALUES placeholders and append bound values to {@link QueryObject#params}.
   *
   * @returns {string|null}
   */
  formatValues() {
    if (!this._insertValues.length) {
      return null;
    }

    const tuples = [];

    for (const row of this._insertValues) {
      const placeholders = [];

      for (const value of row) {
        placeholders.push(`$${this._params.length + 1}`);
        this._params.push(value);
      }

      tuples.push(`(${placeholders.join(", ")})`);
    }

    return tuples.join(", ");
  }

  /** Render ON CONFLICT clause (without trailing semicolon), or null when omitted. */
  formatOnConflict() {
    if (!this._onConflict) {
      return null;
    }

    const { targets, action } = this._onConflict;
    let parts = [];
    parts.push("ON CONFLICT");

    if (targets.length) {
      parts.push(`(${targets.map(quoteColumn).join(", ")})`);
    }
    parts.push(action);

    if (action === "DO UPDATE") {
      const targetSet = new Set(targets);
      const updateColumns = this._insertColumnNames.filter((column) => !targetSet.has(column));

      if (!updateColumns.length) {
        throw new Error("onConflict DO UPDATE requires at least one non-conflict insert column");
      }

      const setClause = updateColumns
        .map((column) => `${quoteColumn(column)} = EXCLUDED.${quoteColumn(column)}`)
        .join(", ");

      parts.push(`SET ${setClause}`);
    }

    return parts.join(" ");
  }

  /** Render SET assignments joined with commas (without the `SET` keyword), or null when empty. */
  formatSet() {
    if (!this._setClauses.length) {
      return null;
    }

    return this._formatClauseGroup(this._setClauses).join(", ");
  }

  /**
   * Render WHERE conditions joined with AND and renumber placeholders into {@link QueryObject#params}.
   *
   * @returns {string|null} SQL after `WHERE`, or null when there are no conditions
   */
  formatWhere() {
    if (!this._whereClauses.length) {
      return null;
    }

    return this._formatClauseGroup(this._whereClauses).join(" AND ");
  }

  /** Render ORDER BY sort keys joined with commas (without the `ORDER BY` keyword). */
  formatOrderBy() {
    const parts = [];

    for (const { expression, tableAlias, column, direction, nullsOrdering } of this._orderByClauses) {
      const clauseParts = [
        expression ?? qualify(tableAlias, column),
        direction,
      ];

      if (nullsOrdering) {
        clauseParts.push(nullsOrdering);
      }

      parts.push(clauseParts.join(" "));
    }

    return parts.join(", ");
  }

  /** Render RETURNING column list (without the `RETURNING` keyword), or null when omitted. */
  formatReturning() {
    if (!this._returning) {
      return null;
    }

    const { tableAlias, fields } = this._returning;
    return fields
      .map((field) => (tableAlias ? qualify(tableAlias, field) : quoteColumn(field)))
      .join(", ");
  }

  /** Render all recorded CREATE TABLE column definitions. */
  formatCreateTableColumns() {
    return this._columns.map((column) => {
      const { name, type, nullable = true, default: defaultValue } = column;
      const parts = [quoteColumn(name), type];

      if (!nullable) {
        parts.push("NOT NULL");
      }
      if (defaultValue !== undefined) {
        parts.push(`DEFAULT ${defaultValue}`);
      }

      return parts.join(" ");
    });
  }

  /** Render all recorded CREATE TABLE constraints. */
  formatTableConstraints() {
    return this._tableConstraints.map((constraint) => {
      switch (constraint.type) {
        case "primaryKey": {
          const columnNames = normalizeToArray(constraint.columns).map(quoteColumn).join(", ");
          return `PRIMARY KEY (${columnNames})`;
        }
        case "foreignKey": {
          const refTable = qualifyTable(constraint.refSchema, constraint.refTable);
          const refColumnName = quoteColumn(constraint.refColumn ?? "guid");

          const parts = [
            `CONSTRAINT ${quoteIdentifier(constraint.constraintName)}`,
            `FOREIGN KEY (${quoteColumn(constraint.column)})`,
            `REFERENCES ${refTable} (${refColumnName})`,
          ];

          if (constraint.onDelete) {
            parts.push(`ON DELETE ${constraint.onDelete}`);
          }

          return parts.join(" ");
        }
        default:
          throw new Error(`Unknown table constraint type: ${constraint.type}`);
      }
    });
  }

  /** Bound parameters accumulated while rendering INSERT, SET, or WHERE clauses. */
  get params() {
    this._resetParams();
    if (this._queryType === "INSERT") {
      this.formatValues();
    } else if (this._queryType === "UPDATE") {
      this.formatSet();
    }
    this.formatWhere();
    return this._params;
  }

  /** Assemble and return an INSERT statement. @returns {string} */
  toStringInsert() {
    const columns = this.formatColumns();
    const placeholders = this.formatValues();
    if (!columns || !placeholders) {
      throw new Error("Query requires at least one row via values() or addRows()");
    }

    const parts = [
      `INSERT INTO ${this.formatFrom()}`,
      `(${columns})`,
      `VALUES ${placeholders}`,
    ];

    const onConflict = this.formatOnConflict();
    if (onConflict) {
      parts.push(onConflict);
    }

    const returning = this.formatReturning();
    if (returning) {
      parts.push(`RETURNING ${returning}`);
    }

    return parts.join("\n");
  }

  /** Assemble and return an UPDATE statement. @returns {string} */
  toStringUpdate() {
    const set = this.formatSet();
    if (!set) {
      throw new Error("Query requires at least one set() or setExpression() assignment");
    }

    const parts = [
      `UPDATE ${this.formatFrom()}`,
      `SET ${set}`,
    ];

    const where = this.formatWhere();
    if (where) {
      parts.push(`WHERE ${where}`);
    }

    const returning = this.formatReturning();
    if (returning) {
      parts.push(`RETURNING ${returning}`);
    }

    return parts.join("\n");
  }

  /** Assemble and return a DELETE statement. @returns {string} */
  toStringDelete() {
    const parts = [`DELETE FROM ${this.formatFrom()}`];

    const where = this.formatWhere();
    if (where) {
      parts.push(`WHERE ${where}`);
    }

    const returning = this.formatReturning();
    if (returning) {
      parts.push(`RETURNING ${returning}`);
    }

    return parts.join("\n");
  }

  /** Assemble and return a CREATE TABLE statement. @returns {string} */
  toStringCreateTable() {
    const definitionParts = [
      ...this.formatCreateTableColumns(),
      ...this.formatTableConstraints(),
    ];
    if (!definitionParts.length) {
      throw new Error("CREATE TABLE requires at least one addColumn(), primaryKey(), or foreignKey()");
    }

    const parts = ["CREATE TABLE"];
    if (this._ifNotExists) {
      parts.push("IF NOT EXISTS");
    }
    parts.push(this.formatFrom());
    parts.push("(" + definitionParts.join(", ") + ")");
    return parts.join(" ");
  }

  /** Assemble and return one or more ALTER TABLE statements. @returns {string} */
  toStringAlterTable() {
    const columns = this.formatCreateTableColumns();
    if (!columns.length) {
      throw new Error("ALTER TABLE requires addColumn() and addColumnIfNotExists()");
    }

    const target = this.formatFrom();
    const ifNotExists = this._alterIfNotExists ? " IF NOT EXISTS" : "";
    const parts = columns.map(
      (column) => `ALTER TABLE ${target} ADD COLUMN${ifNotExists} ${column};`,
    );

    return parts.join("\n");
  }

  /** Assemble and return a SELECT statement. @returns {string} */
  toStringSelect() {
    const select = this.formatSelect();

    if (!select) {
      throw new Error("Query requires at least one select field or expression");
    }

    const parts = [
      `SELECT ${select}`,
      `FROM ${this.formatFrom()}`,
      ...this.formatJoins(),
    ];

    const where = this.formatWhere();
    if (where) {
      parts.push(`WHERE ${where}`);
    }

    const orderBy = this.formatOrderBy();
    if (orderBy) {
      parts.push(`ORDER BY ${orderBy}`);
    }

    if (this._limit !== null) {
      parts.push(`LIMIT ${this._limit}`);
    }

    return parts.join("\n");
  }

  /** Assemble and return the full query statement. @returns {string} */
  toString() {
    if (!this._from) {
      throw new Error("Query requires from() or into()");
    }

    this._resetParams();
    switch (this._queryType) {
      case "SELECT":
        return this.toStringSelect();
      case "INSERT":
        return this.toStringInsert();
      case "UPDATE":
        return this.toStringUpdate();
      case "DELETE":
        return this.toStringDelete();
      case "CREATE TABLE":
        return this.toStringCreateTable();
      case "ALTER TABLE":
        return this.toStringAlterTable();
      default:
        throw new Error(`Unknown query type: ${this._queryType}`);
    }
  }
}

/** Create a new {@link QueryObject} for building a SELECT query. @returns {QueryObject} */
function selectQuery() {
  return new QueryObject("SELECT");
}

/** Create a new {@link QueryObject} for building an INSERT query. @returns {QueryObject} */
function insertQuery() {
  return new QueryObject("INSERT");
}

/** Create a new {@link QueryObject} for building an UPDATE query. @returns {QueryObject} */
function updateQuery() {
  return new QueryObject("UPDATE");
}

/** Create a new {@link QueryObject} for building a DELETE query. @returns {QueryObject} */
function deleteQuery() {
  return new QueryObject("DELETE");
}

/** Create a new {@link QueryObject} for building a CREATE TABLE query. @returns {QueryObject} */
function createTableQuery() {
  return new QueryObject("CREATE TABLE");
}

/** Create a new {@link QueryObject} for building an ALTER TABLE query. @returns {QueryObject} */
function alterTableQuery() {
  return new QueryObject("ALTER TABLE");
}

/**
 * Build a CREATE SCHEMA IF NOT EXISTS statement with a safely quoted schema name.
 *
 * @param {string} schema
 * @returns {string}
 */
function createSchemaQuery(schema) {
  return `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`;
}

/**
 * Build CREATE OR REPLACE FUNCTION … set_{column}() that sets NEW.column to now() on each row.
 *
 * @param {string} schema
 * @param {string} column
 * @returns {string}
 */
function createUpdateFunctionQuery(schema, column) {
  const functionName = `set_${column}`;
  return [
    `CREATE OR REPLACE FUNCTION ${qualifyTable(schema, functionName)}()`,
    "RETURNS trigger AS $$",
    "BEGIN",
    `  NEW.${quoteColumn(column)} = now();`,
    "  RETURN NEW;",
    "END;",
    "$$ LANGUAGE plpgsql;",
  ].join("\n");
}

/**
 * Build DROP TRIGGER IF EXISTS + CREATE TRIGGER … BEFORE UPDATE … EXECUTE FUNCTION set_{column}().
 *
 * Trigger name is `{table}_{column}` (e.g. `users_update_datetime`).
 *
 * @param {string} tableSchema schema owning the table
 * @param {string} table
 * @param {string} column column updated by the trigger function
 * @param {string} [functionSchema=tableSchema] schema owning the trigger function
 * @returns {string}
 */
function createBeforeUpdateTriggerQuery(tableSchema, table, column, functionSchema = tableSchema) {
  const functionName = `set_${column}`;
  const triggerName = `${table}_${column}`;
  const qualifiedTable = qualifyTable(tableSchema, table);
  const qualifiedFunction = qualifyTable(functionSchema, functionName);
  return [
    `DROP TRIGGER IF EXISTS ${quoteIdentifier(triggerName)} ON ${qualifiedTable};`,
    `CREATE TRIGGER ${quoteIdentifier(triggerName)}`,
    `  BEFORE UPDATE ON ${qualifiedTable}`,
    `  FOR EACH ROW EXECUTE FUNCTION ${qualifiedFunction}();`,
  ].join("\n");
}

module.exports = {
  selectQuery,
  insertQuery,
  updateQuery,
  deleteQuery,
  createTableQuery,
  alterTableQuery,
  createSchemaQuery,
  createUpdateFunctionQuery,
  createBeforeUpdateTriggerQuery,
  qualify,
  qualifyTable,
  quoteIdentifier,
  quoteColumn,
};
