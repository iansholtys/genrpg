const { quoteIdentifier, quoteColumn } = require("../lib/entityExtensions");

function normalizeToArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return [value];
}

function formatField(tableAlias, field, alias) {
  const part = `${quoteIdentifier(tableAlias)}.${quoteColumn(field)}`;

  if (alias !== undefined && alias !== null && alias !== "") {
    return `${part} AS ${quoteIdentifier(alias)}`;
  }

  return part;
}

function formatFrom({ schema, table, alias }) {
  let sql = `FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

  if (alias) {
    sql += ` ${quoteIdentifier(alias)}`;
  }

  return sql;
}

function formatJoin({ type = "INNER", schema, table, tableAlias, joinCondition }) {
  const joinKeyword = type === "LEFT" ? "LEFT JOIN" : "JOIN";
  let sql = `${joinKeyword} ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

  if (tableAlias) {
    sql += ` ${quoteIdentifier(tableAlias)}`;
  }

  sql += ` ON ${joinCondition}`;
  return sql;
}

function renumberPlaceholders(expression, startIndex) {
  return expression.replace(/\$(\d+)/g, (_, number) => `$${startIndex + Number(number) - 1}`);
}

function formatWhereClauses(clauses) {
  let paramOffset = 1;
  const params = [];
  const parts = [];

  for (const clause of clauses) {
    parts.push(renumberPlaceholders(clause.expression, paramOffset));
    params.push(...clause.args);
    paramOffset += clause.args.length;
  }

  return {
    sql: parts.join(" AND "),
    params,
  };
}

class QueryObject {
  constructor() {
    this._fieldGroups = [];
    this._expressions = [];
    this._from = null;
    this._joins = [];
    this._whereClauses = [];
  }

  from(schema, table, alias) {
    this._from = { schema, table, alias };
    return this;
  }

  addFields(tableAlias, fields, aliases) {
    this._fieldGroups.push({
      tableAlias,
      fields,
      aliases,
    });
    return this;
  }

  addExpression(expression, alias) {
    this._expressions.push({ expression, alias });
    return this;
  }

  _addJoin(type, schema, table, tableAliasOrCondition, joinCondition) {
    let tableAlias;
    let condition;

    if (joinCondition !== undefined) {
      tableAlias = tableAliasOrCondition;
      condition = joinCondition;
    } else {
      tableAlias = undefined;
      condition = tableAliasOrCondition;
    }

    this._joins.push({
      type,
      schema,
      table,
      tableAlias,
      joinCondition: condition,
    });
    return this;
  }

  addJoin(schema, table, tableAliasOrCondition, joinCondition) {
    return this._addJoin("INNER", schema, table, tableAliasOrCondition, joinCondition);
  }

  addLeftJoin(schema, table, tableAliasOrCondition, joinCondition) {
    return this._addJoin("LEFT", schema, table, tableAliasOrCondition, joinCondition);
  }

  where(expression, args = []) {
    this._whereClauses.push({
      expression,
      args,
    });
    return this;
  }

  get params() {
    return formatWhereClauses(this._whereClauses).params;
  }

  toString() {
    const selectParts = [];

    for (const group of this._fieldGroups) {
      const fields = normalizeToArray(group.fields);
      const aliases = group.aliases !== undefined ? normalizeToArray(group.aliases) : [];

      for (let index = 0; index < fields.length; index += 1) {
        const alias = index in aliases ? aliases[index] : undefined;
        selectParts.push(formatField(group.tableAlias, fields[index], alias));
      }
    }

    for (const { expression, alias } of this._expressions) {
      if (alias !== undefined && alias !== null && alias !== "") {
        selectParts.push(`${expression} AS ${quoteIdentifier(alias)}`);
      } else {
        selectParts.push(expression);
      }
    }

    if (selectParts.length === 0) {
      throw new Error("Query requires at least one select field or expression");
    }

    if (!this._from) {
      throw new Error("Query requires from()");
    }

    const parts = [
      `SELECT ${selectParts.join(", ")}`,
      formatFrom(this._from),
      ...this._joins.map(formatJoin),
    ];

    if (this._whereClauses.length > 0) {
      parts.push(`WHERE ${formatWhereClauses(this._whereClauses).sql}`);
    }

    return parts.join("\n");
  }
}

function select() {
  return new QueryObject();
}

module.exports = {
  select,
};
