const express = require("express");
const { BadRequestError } = require("../errors/BadRequestError");
const { NotFoundError } = require("../errors/NotFoundError");
const { ValidationError } = require("../errors/ValidationError");
const { withTransaction } = require("../db/transactionContext");
const {
  PERMISSION_VIEW,
  PERMISSION_EDIT,
  assertInstancePermissions,
} = require("./instanceContext");
const { asyncRoute } = require("../lib/httpResponse");
const { trimmedString } = require("../lib/strings");
const ItemCollectionStorage = require("../../genrpg/storage/itemCollectionStorage");

const itemCollectionsRouter = express.Router();

function parseOptionalUuid(value, fieldLabel) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return trimmedString(value) || { error: `${fieldLabel} must be a string` };
}

function parseItemCollectionListQuery(query) {
  const itemGuid = parseOptionalUuid(query.itemGuid, "Item");
  if (itemGuid?.error) {
    throw new BadRequestError(itemGuid.error);
  }

  return { itemGuid, type: trimmedString(query.type) };
}

itemCollectionsRouter.get("/instances/:instanceGuid/item-collections/form", asyncRoute(async (req, res) => {
  const context = await assertInstancePermissions(req, PERMISSION_VIEW);
  const metadata = await ItemCollectionStorage.Entity.getFormSchema(context);
  res.json(metadata);
}));

itemCollectionsRouter.get("/instances/:instanceGuid/item-collections", asyncRoute(async (req, res) => {
  const context = await assertInstancePermissions(req, PERMISSION_VIEW);
  const filters = parseItemCollectionListQuery(req.query);
  const entities = await ItemCollectionStorage.forInstance(context.instance).list(filters);
  res.json({ itemCollections: entities.map((entity) => entity.toJSON()) });
}));

itemCollectionsRouter.get(
  "/instances/:instanceGuid/item-collections/:collectionGuid",
  asyncRoute(async (req, res) => {
    const context = await assertInstancePermissions(req, PERMISSION_VIEW);
    const entity = await ItemCollectionStorage.forInstance(context.instance).load(
      req.params.collectionGuid,
    );
    if (!entity) {
      throw new NotFoundError("Item collection not found");
    }
    res.json({ itemCollection: entity.toJSON() });
  }),
);

itemCollectionsRouter.post("/instances/:instanceGuid/item-collections", asyncRoute(async (req, res) => {
  const context = await assertInstancePermissions(req, PERMISSION_EDIT);
  const itemCollection = await withTransaction(async () => {
    const storage = ItemCollectionStorage.forInstance(context.instance);
    const entity = await storage.create();
    entity.set(req.body);
    const validationErrors = await entity.validate();
    if (validationErrors.length) {
      throw new ValidationError(validationErrors);
    }
    await entity.save();
    return entity.toJSON();
  });
  res.status(201).json({ itemCollection });
}));

itemCollectionsRouter.put(
  "/instances/:instanceGuid/item-collections/:collectionGuid",
  asyncRoute(async (req, res) => {
    const context = await assertInstancePermissions(req, PERMISSION_EDIT);
    const itemCollection = await withTransaction(async () => {
      const entity = await ItemCollectionStorage.forInstance(context.instance).load(
        req.params.collectionGuid,
      );
      if (!entity) {
        throw new NotFoundError("Item collection not found");
      }
      entity.set(req.body);
      const validationErrors = await entity.validate();
      if (validationErrors.length) {
        throw new ValidationError(validationErrors);
      }
      const saved = await entity.save();
      if (!saved) {
        throw new NotFoundError("Item collection not found");
      }
      return entity.toJSON();
    });
    res.json({ itemCollection });
  }),
);

itemCollectionsRouter.delete(
  "/instances/:instanceGuid/item-collections/:collectionGuid",
  asyncRoute(async (req, res) => {
    const context = await assertInstancePermissions(req, PERMISSION_EDIT);
    await withTransaction(async () => {
      const storage = ItemCollectionStorage.forInstance(context.instance);
      const entity = await storage.load(req.params.collectionGuid);
      if (!entity) {
        throw new NotFoundError("Item collection not found");
      }
      const deleted = await entity.delete();
      if (!deleted) {
        throw new NotFoundError("Item collection not found");
      }
    });
    res.status(204).send();
  }),
);

module.exports = itemCollectionsRouter;
