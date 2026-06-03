const express = require("express");
const { HttpError } = require("../errors/HttpError");
const { NotFoundError } = require("../errors/NotFoundError");
const { ValidationError } = require("../errors/ValidationError");
const { withTransaction } = require("../db/transactionContext");
const {
  PERMISSION_VIEW,
  PERMISSION_EDIT,
  assertInstancePermissions,
} = require("./instanceContext");
const { handleRouteError } = require("../lib/httpResponse");
const ItemTemplateStorage = require("../storage/itemTemplateStorage");

const itemTemplatesRouter = express.Router();

const DELETE_CONFLICT_MESSAGE = "Cannot delete this template while items still reference it";
itemTemplatesRouter.get("/instances/:instanceGuid/item-templates", async (req, res, next) => {
  try {
    const context = await assertInstancePermissions(req, PERMISSION_VIEW);
    const entities = await ItemTemplateStorage.forInstance(context.instanceGuid).list();
    res.json({ itemTemplates: entities.map((entity) => entity.toJSON()) });
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

itemTemplatesRouter.get(
  "/instances/:instanceGuid/item-templates/:templateGuid",
  async (req, res, next) => {
    try {
      const context = await assertInstancePermissions(req, PERMISSION_VIEW);
      const entity = await ItemTemplateStorage.forInstance(context.instanceGuid).load(
        req.params.templateGuid,
      );
      if (!entity) {
        throw new NotFoundError("Item template not found");
      }
      res.json({ itemTemplate: entity.toJSON() });
    } catch (error) {
      handleRouteError(res, error, next);
    }
  },
);

itemTemplatesRouter.post("/instances/:instanceGuid/item-templates", async (req, res, next) => {
  try {
    const context = await assertInstancePermissions(req, PERMISSION_EDIT);
    const itemTemplate = await withTransaction(async () => {
      const bound = ItemTemplateStorage.forInstance(context.instanceGuid);
      const entity = bound.create();
      entity.set(req.body);
      const validationErrors = await entity.validate();
      if (validationErrors.length) {
        throw new ValidationError(validationErrors);
      }
      await entity.save();
      return entity.toJSON();
    });
    res.status(201).json({ itemTemplate });
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

itemTemplatesRouter.put(
  "/instances/:instanceGuid/item-templates/:templateGuid",
  async (req, res, next) => {
    try {
      const context = await assertInstancePermissions(req, PERMISSION_EDIT);
      const itemTemplate = await withTransaction(async () => {
        const bound = ItemTemplateStorage.forInstance(context.instanceGuid);
        const entity = await bound.load(req.params.templateGuid);
        if (!entity) {
          throw new NotFoundError("Item template not found");
        }
        entity.set(req.body);
        const validationErrors = await entity.validate();
      if (validationErrors.length) {
        throw new ValidationError(validationErrors);
      }
        const saved = await entity.save();
        if (!saved) {
          throw new NotFoundError("Item template not found");
        }
        return entity.toJSON();
      });
      res.json({ itemTemplate });
    } catch (error) {
      handleRouteError(res, error, next);
    }
  },
);

itemTemplatesRouter.delete(
  "/instances/:instanceGuid/item-templates/:templateGuid",
  async (req, res, next) => {
    try {
      const context = await assertInstancePermissions(req, PERMISSION_EDIT);
      await withTransaction(async () => {
        try {
          const deleted = await ItemTemplateStorage.forInstance(context.instanceGuid).delete(
            req.params.templateGuid,
          );
          if (!deleted) {
            throw new NotFoundError("Item template not found");
          }
        } catch (error) {
          if (error.code === "23503") {
            throw new HttpError(409, DELETE_CONFLICT_MESSAGE);
          }
          throw error;
        }
      });
      res.status(204).send();
    } catch (error) {
      handleRouteError(res, error, next);
    }
  },
);

module.exports = itemTemplatesRouter;
