const express = require("express");
const { BadRequestError } = require("../errors/BadRequestError");
const { normalizeAlias } = require("../../genrpg/entities/urlAlias");
const {
  instancePath,
  lookupAlias,
  canonicalAliasForPath,
  resolvePath,
} = require("../services/urlResolver");
const { asyncRoute } = require("../lib/httpResponse");
const { trimmedString } = require("../lib/strings");

const aliasesRouter = express.Router();

function requireNormalizedAlias(value) {
  const alias = normalizeAlias(value);
  if (!alias) {
    throw new BadRequestError("alias is required");
  }
  return alias;
}

function requirePath(value) {
  const path = trimmedString(value);
  if (!path) {
    throw new BadRequestError("path is required");
  }
  return path;
}

aliasesRouter.get("/aliases/availability", asyncRoute(async (req, res) => {
  const alias = requireNormalizedAlias(req.query.alias);
  const aliasInfo = await lookupAlias(alias);
  const excludeGuid = trimmedString(req.query.excludeInstanceGuid);
  const available = !aliasInfo || (excludeGuid != null && aliasInfo.path === instancePath(excludeGuid));
  res.json({ available });
}));

aliasesRouter.get("/aliases/resolve", asyncRoute(async (req, res) => {
  const alias = requireNormalizedAlias(req.query.alias);
  const aliasInfo = await lookupAlias(alias);
  if (!aliasInfo) {
    res.json({ resolved: null });
    return;
  }

  const resolved = await resolvePath(aliasInfo.path, req.session.user);
  res.json({
    resolved,
    path: aliasInfo.path,
    alias: aliasInfo.alias,
  });
}));

aliasesRouter.get("/aliases/for-path", asyncRoute(async (req, res) => {
  const path = requirePath(req.query.path);
  const alias = await canonicalAliasForPath(path);
  res.json({ alias });
}));

aliasesRouter.get("/aliases/resolve-path", asyncRoute(async (req, res) => {
  const path = requirePath(req.query.path);
  const resolved = await resolvePath(path, req.session.user);
  res.json({ resolved });
}));

module.exports = aliasesRouter;
