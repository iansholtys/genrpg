const express = require("express");
const {
  normalizeAlias,
  lookupAlias,
  isAliasAvailable,
  lookupCanonicalAliasForPath,
  resolveAlias,
  resolvePath,
} = require("../aliases");
const { trimmedString } = require("../lib/strings");

const aliasesRouter = express.Router();

aliasesRouter.get("/aliases/availability", async (req, res, next) => {
  try {
    const alias = normalizeAlias(req.query.alias);
    if (!alias) {
      res.status(400).json({ error: "alias is required" });
      return;
    }

    const available = await isAliasAvailable(alias, {
      excludeInstanceGuid: trimmedString(req.query.excludeInstanceGuid) || undefined,
    });
    res.json({ available });
  } catch (error) {
    next(error);
  }
});

aliasesRouter.get("/aliases/resolve", async (req, res, next) => {
  try {
    const alias = normalizeAlias(req.query.alias);
    if (!alias) {
      res.status(400).json({ error: "alias is required" });
      return;
    }

    const row = await lookupAlias(alias);
    if (!row) {
      res.json({ resolved: null });
      return;
    }

    const boot = await resolveAlias(alias, req.session.user);
    res.json({
      resolved: boot,
      path: row.path,
      alias: row.alias,
    });
  } catch (error) {
    next(error);
  }
});

aliasesRouter.get("/aliases/for-path", async (req, res, next) => {
  try {
    const pathValue = trimmedString(req.query.path);
    if (!pathValue) {
      res.status(400).json({ error: "path is required" });
      return;
    }

    const alias = await lookupCanonicalAliasForPath(pathValue);
    res.json({ alias });
  } catch (error) {
    next(error);
  }
});

aliasesRouter.get("/aliases/resolve-path", async (req, res, next) => {
  try {
    const pathValue = trimmedString(req.query.path);
    if (!pathValue) {
      res.status(400).json({ error: "path is required" });
      return;
    }

    const boot = await resolvePath(pathValue, req.session.user);
    res.json({ resolved: boot });
  } catch (error) {
    next(error);
  }
});

module.exports = aliasesRouter;
