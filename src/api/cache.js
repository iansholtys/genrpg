const express = require("express");

const { requireAdmin } = require("../auth");
const { clear } = require("../services/cacheService");

const cacheRouter = express.Router();

cacheRouter.post("/cache/clear", requireAdmin, async (req, res, next) => {
  try {
    const { instanceGuid, keyPrefix } = req.body ?? {};
    const options = {};

    if (instanceGuid !== undefined && instanceGuid !== null) {
      if (typeof instanceGuid !== "string") {
        res.status(400).json({ error: "instanceGuid must be a string" });
        return;
      }
      options.instanceGuid = instanceGuid;
    }

    if (keyPrefix !== undefined && keyPrefix !== null) {
      if (typeof keyPrefix !== "string") {
        res.status(400).json({ error: "keyPrefix must be a string" });
        return;
      }
      options.keyPrefix = keyPrefix;
    }

    const cleared = await clear(options);
    res.json({ success: true, cleared });
  } catch (error) {
    next(error);
  }
});

module.exports = cacheRouter;
