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
const { asyncRoute } = require("../lib/httpResponse");
const ItemTemplateStorage = require("../../genrpg/storage/itemTemplateStorage");
const ItemStorage = require("../../genrpg/storage/itemStorage");

const itemTemplatesRouter = express.Router();

const DELETE_CONFLICT_MESSAGE = "Cannot delete this template while items still reference it";

itemTemplatesRouter.get("/instances/:instanceGuid/item-templates/form", asyncRoute(async (req, res) => {
  const context = await assertInstancePermissions(req, PERMISSION_VIEW);
  const metadata = await ItemTemplateStorage.Entity.getFormSchema(context);
  res.json(metadata);
}));

itemTemplatesRouter.get("/instances/:instanceGuid/item-templates", asyncRoute(async (req, res) => {
  const context = await assertInstancePermissions(req, PERMISSION_VIEW);
  const entities = await ItemTemplateStorage.forInstance(context.instance).list();
  res.json({ itemTemplates: entities.map((entity) => entity.toJSON()) });
}));

itemTemplatesRouter.get(
  "/instances/:instanceGuid/item-templates/:templateGuid",
  asyncRoute(async (req, res) => {
    const context = await assertInstancePermissions(req, PERMISSION_VIEW);
    const entity = await ItemTemplateStorage.forInstance(context.instance).load(
      req.params.templateGuid,
    );
    if (!entity) {
      throw new NotFoundError("Item template not found");
    }
    res.json({ itemTemplate: entity.toJSON() });
  }),
);

itemTemplatesRouter.post("/instances/:instanceGuid/item-templates", asyncRoute(async (req, res) => {
  const context = await assertInstancePermissions(req, PERMISSION_EDIT);
  const itemTemplate = await withTransaction(async () => {
    const storage = ItemTemplateStorage.forInstance(context.instance);
    const entity = await storage.create();
    entity.set(req.body);
    const validationErrors = await entity.validate();
    if (validationErrors.length) {
      throw new ValidationError(validationErrors);
    }
    await entity.save();
    return entity.toJSON();
  });
  res.status(201).json({ itemTemplate });
}));

itemTemplatesRouter.put(
  "/instances/:instanceGuid/item-templates/:templateGuid",
  asyncRoute(async (req, res) => {
    const context = await assertInstancePermissions(req, PERMISSION_EDIT);
    const itemTemplate = await withTransaction(async () => {
      const bound = ItemTemplateStorage.forInstance(context.instance);
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
  }),
);

itemTemplatesRouter.delete(
  "/instances/:instanceGuid/item-templates/:templateGuid",
  asyncRoute(async (req, res) => {
    const context = await assertInstancePermissions(req, PERMISSION_EDIT);
    await withTransaction(async () => {
      const itemStorage = ItemStorage.forInstance(context.instance);
      if (await itemStorage.countEntities({ itemTemplateGuid: req.params.templateGuid })) {
        throw new HttpError(409, DELETE_CONFLICT_MESSAGE);
      }

      try {
        const deleted = await ItemTemplateStorage.forInstance(context.instance).delete(
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
  }),
);

module.exports = itemTemplatesRouter;
