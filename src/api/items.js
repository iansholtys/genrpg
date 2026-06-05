const express = require("express");
const { NotFoundError } = require("../errors/NotFoundError");
const { ValidationError } = require("../errors/ValidationError");
const { withTransaction } = require("../db/transactionContext");
const {
  PERMISSION_VIEW,
  PERMISSION_EDIT,
  assertInstancePermissions,
} = require("./instanceContext");
const { handleRouteError } = require("../lib/httpResponse");
const ItemStorage = require("../storage/itemStorage");

const itemsRouter = express.Router();

itemsRouter.get("/instances/:instanceGuid/items", async (req, res, next) => {
  try {
    const context = await assertInstancePermissions(req, PERMISSION_VIEW);
    const entities = await ItemStorage.forInstance(context.instance).list();
    res.json({ items: entities.map((entity) => entity.toJSON()) });
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

itemsRouter.get("/instances/:instanceGuid/items/:itemGuid", async (req, res, next) => {
  try {
    const context = await assertInstancePermissions(req, PERMISSION_VIEW);
    const entity = await ItemStorage.forInstance(context.instance).load(req.params.itemGuid);
    if (!entity) {
      throw new NotFoundError("Item not found");
    }
    res.json({ item: entity.toJSON() });
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

itemsRouter.post("/instances/:instanceGuid/items", async (req, res, next) => {
  try {
    const context = await assertInstancePermissions(req, PERMISSION_EDIT);
    const item = await withTransaction(async () => {
      const storage = ItemStorage.forInstance(context.instance);
      const entity = await storage.create();
      entity.set(req.body);
      const validationErrors = await entity.validate();
      if (validationErrors.length) {
        throw new ValidationError(validationErrors);
      }
      await entity.save();
      return entity.toJSON();
    });
    res.status(201).json({ item });
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

itemsRouter.put("/instances/:instanceGuid/items/:itemGuid", async (req, res, next) => {
  try {
    const context = await assertInstancePermissions(req, PERMISSION_EDIT);
    const item = await withTransaction(async () => {
      const storage = ItemStorage.forInstance(context.instance);
      const entity = await storage.load(req.params.itemGuid);
      if (!entity) {
        throw new NotFoundError("Item not found");
      }
      entity.set(req.body);
      const validationErrors = await entity.validate();
      if (validationErrors.length) {
        throw new ValidationError(validationErrors);
      }
      const saved = await entity.save();
      if (!saved) {
        throw new NotFoundError("Item not found");
      }
      return entity.toJSON();
    });
    res.json({ item });
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

itemsRouter.delete("/instances/:instanceGuid/items/:itemGuid", async (req, res, next) => {
  try {
    const context = await assertInstancePermissions(req, PERMISSION_EDIT);
    await withTransaction(async () => {
      const deleted = await ItemStorage.forInstance(context.instance).delete(req.params.itemGuid);
      if (!deleted) {
        throw new NotFoundError("Item not found");
      }
    });
    res.status(204).send();
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

module.exports = itemsRouter;
