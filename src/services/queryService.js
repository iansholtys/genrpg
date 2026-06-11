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
 * Fluent builder for PostgreSQL SELECT, INSERT, UPDATE, and DELETE queries.
 *
 * Call {@link selectQuery}, {@link insertQuery}, {@link updateQuery}, or {@link deleteQuery}
 * to obtain a {@link QueryObject}, chain configuration methods, then pass
 * {@link QueryObject#toString toString()} and {@link QueryObject#params params} to pg.
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
 * Builds a SELECT, INSERT, UPDATE, or DELETE query through a chainable API.
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
   * Add INSERT column names and bound values.
   *
   * `columns` and `values` may be strings or arrays (mapped in order; lengths must match).
   * Each value becomes one `$n` param. May be called more than once to append columns.
   *
   * @param {string|string[]} columns
   * @param {unknown|unknown[]} values
   */
  values(columns, columnValues) {
    this._requireType("INSERT", "values");

    const columnNames = normalizeToArray(columns);
    const boundValues = normalizeToArray(columnValues);

    if (columnNames.length !== boundValues.length) {
      throw new Error("values() columns and values must be the same length");
    }

    this._insertColumnNames.push(...columnNames);
    this._insertValues.push(...boundValues);
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

    const placeholders = [];

    for (const value of this._insertValues) {
      placeholders.push(`$${this._params.length + 1}`);
      this._params.push(value);
    }

    return placeholders.join(", ");
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
      throw new Error("Query requires at least one values() assignment");
    }

    const parts = [
      `INSERT INTO ${this.formatFrom()}`,
      `(${columns})`,
      `VALUES (${placeholders})`,
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

module.exports = {
  selectQuery,
  insertQuery,
  updateQuery,
  deleteQuery,
  qualify,
  quoteIdentifier,
  quoteColumn,
};
