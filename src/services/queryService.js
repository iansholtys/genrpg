const { quoteIdentifier, quoteColumn } = require("../lib/entityExtensions");

function normalizeToArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return [value];
}

function qualify(tableAlias, column) {
  return `${quoteIdentifier(tableAlias)}.${quoteColumn(column)}`;
}

function formatField(tableAlias, field, alias) {
  const part = qualify(tableAlias, field);

  if (alias !== undefined && alias !== null && alias !== "") {
    return `${part} AS ${quoteIdentifier(alias)}`;
  }

  return part;
}

function renumberPlaceholders(expression, startIndex) {
  return expression.replace(/\$(\d+)/g, (_, number) => `$${startIndex + Number(number) - 1}`);
}

class QueryObject {
  constructor() {
    this._fieldGroups = [];
    this._expressions = [];
    this._from = null;
    this._joins = [];
    this._whereClauses = [];
    this._whereParams = [];
    this._orderByClauses = [];
  }

  from(schema, table, tableAlias) {
    this._from = { schema, table, tableAlias };
    return this;
  }

  addFields(tableAlias, fields, aliases) {
    this._fieldGroups.push({
      tableAlias,
      fields: normalizeToArray(fields),
      aliases: aliases !== undefined ? normalizeToArray(aliases) : undefined,
    });
    return this;
  }

  addExpression(expression, alias) {
    this._expressions.push({ expression, alias });
    return this;
  }

  _addJoin(type, schema, table, tableAlias, joinCondition) {
    this._joins.push({
      type,
      schema,
      table,
      tableAlias,
      joinCondition,
    });
    return this;
  }

  addJoin(schema, table, tableAlias, joinCondition) {
    return this._addJoin("INNER", schema, table, tableAlias, joinCondition);
  }

  addLeftJoin(schema, table, tableAlias, joinCondition) {
    return this._addJoin("LEFT", schema, table, tableAlias, joinCondition);
  }

  where(expression, args = []) {
    this._whereClauses.push({
      expression,
      args,
    });
    return this;
  }

  orderBy(tableAlias, column, direction = "ASC", nullsOrdering = null) {
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

  formatFrom() {
    const { schema, table, tableAlias } = this._from;
    let sql = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

    if (tableAlias) {
      sql += ` ${quoteIdentifier(tableAlias)}`;
    }

    return sql;
  }

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

  get params() {
    this.formatWhere();
    return this._whereParams;
  }

  toString() {
    const select = this.formatSelect();

    if (!select) {
      throw new Error("Query requires at least one select field or expression");
    }

    if (!this._from) {
      throw new Error("Query requires from()");
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
}

function select() {
  return new QueryObject();
}

module.exports = {
  select,
  qualify,
};
