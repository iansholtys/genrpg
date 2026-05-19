const express = require("express");
const {
  normalizeAlias,
  lookupAlias,
  lookupCanonicalAliasForPath,
  resolveAlias,
  resolvePath,
} = require("../aliases");

const aliasesRouter = express.Router();

aliasesRouter.get("/aliases/availability", async (req, res, next) => {
  try {
    const alias = normalizeAlias(req.query.alias);
    if (!alias) {
      res.status(400).json({ error: "alias is required" });
      return;
    }

    const row = await lookupAlias(alias);
    res.json({ available: !row });
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
    const pathValue = typeof req.query.path === "string" ? req.query.path.trim() : "";
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
    const pathValue = typeof req.query.path === "string" ? req.query.path.trim() : "";
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
