const { quoteIdentifier, quoteColumn } = require("../lib/entityExtensions");

/**
 * Fluent builder for PostgreSQL SELECT and DELETE queries.
 *
 * Call {@link selectQuery} or {@link deleteQuery} to obtain a {@link QueryObject}, chain
 * configuration methods, then pass {@link QueryObject#toString toString()} and
 * {@link QueryObject#params params} to pg. This module only builds SQL strings; it does not
 * execute them.
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
 * Builds a SELECT or DELETE query through a chainable API.
 */
class QueryObject {
  constructor(queryType = "SELECT") {
    this._queryType = queryType;
    this._fieldGroups = [];
    this._expressions = [];
    this._from = null;
    this._joins = [];
    this._whereClauses = [];
    this._whereParams = [];
    this._orderByClauses = [];
    this._returning = null;
  }

  /** @param {"SELECT"|"DELETE"} queryType @param {string} methodName */
  _requireType(queryType, methodName) {
    if (this._queryType !== queryType) {
      throw new Error(`${methodName}() is only valid on ${queryType} queries`);
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
   * Add a RETURNING clause (DELETE only).
   *
   * @param {string} tableAlias
   * @param {string|string[]} fields column names to return
   */
  returning(tableAlias, fields) {
    this._requireType("DELETE", "returning");

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

  /**
   * Render WHERE conditions joined with AND, renumber placeholders, and update {@link QueryObject#params}.
   *
   * @returns {string|null} SQL after `WHERE`, or null when there are no conditions
   */
  formatWhere() {
    if (!this._whereClauses.length) {
      this._whereParams = [];
      return null;
    }

    let paramOffset = 1;
    const params = [];
    const parts = [];

    for (const clause of this._whereClauses) {
      parts.push(renumberPlaceholders(clause.expression, paramOffset));
      params.push(...clause.args);
      paramOffset += clause.args.length;
    }

    this._whereParams = params;
    return parts.join(" AND ");
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
    return fields.map((field) => qualify(tableAlias, field)).join(", ");
  }

  /** Bound parameters for all WHERE clauses, in placeholder order. */
  get params() {
    this.formatWhere();
    return this._whereParams;
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

    return parts.join("\n");
  }

  /** Assemble and return the full query statement. @returns {string} */
  toString() {
    if (!this._from) {
      throw new Error("Query requires from()");
    }

    switch (this._queryType) {
      case "SELECT":
        return this.toStringSelect();
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

/** Create a new {@link QueryObject} for building a DELETE query. @returns {QueryObject} */
function deleteQuery() {
  return new QueryObject("DELETE");
}

module.exports = {
  selectQuery,
  deleteQuery,
  qualify,
};
