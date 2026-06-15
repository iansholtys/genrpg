const express = require("express");
const { NotFoundError } = require("../errors/NotFoundError");
const { ValidationError } = require("../errors/ValidationError");
const { withTransaction } = require("../db/transactionContext");
const {
  PERMISSION_VIEW,
  PERMISSION_EDIT,
  assertInstancePermissions,
} = require("./instanceContext");
const { asyncRoute } = require("../lib/httpResponse");
const ItemEntity = require("../../genrpg/entities/item");
const ItemStorage = require("../../genrpg/storage/itemStorage");
const ItemTemplateStorage = require("../../genrpg/storage/itemTemplateStorage");

const itemsRouter = express.Router();

async function attachItemTemplates(instance, entities) {
  const items = Array.isArray(entities) ? entities : [entities];
  if (!items.length) {
    return entities;
  }

  const templateGuids = [...new Set(items.map((item) => item.itemTemplateGuid).filter(Boolean))];
  const templates = templateGuids.length
    ? await ItemTemplateStorage.forInstance(instance).load(templateGuids)
    : [];
  const templatesByGuid = new Map(templates.map((template) => [template.guid, template]));

  for (const item of items) {
    item.itemTemplate = templatesByGuid.get(item.itemTemplateGuid) ?? null;
  }

  return entities;
}

async function itemToJson(instance, entity) {
  await attachItemTemplates(instance, entity);
  return entity.toJSON();
}

async function itemsToJson(instance, entities) {
  await attachItemTemplates(instance, entities);
  return entities.map((entity) => entity.toJSON());
}

itemsRouter.get("/instances/:instanceGuid/items/form", asyncRoute(async (req, res) => {
  const context = await assertInstancePermissions(req, PERMISSION_VIEW);
  const metadata = await ItemEntity.getFormSchema(context);
  res.json(metadata);
}));

itemsRouter.get("/instances/:instanceGuid/items", asyncRoute(async (req, res) => {
  const context = await assertInstancePermissions(req, PERMISSION_VIEW);
  const entities = await ItemStorage.forInstance(context.instance).list();
  res.json({ items: await itemsToJson(context.instance, entities) });
}));

itemsRouter.get("/instances/:instanceGuid/items/:itemGuid", asyncRoute(async (req, res) => {
  const context = await assertInstancePermissions(req, PERMISSION_VIEW);
  const entity = await ItemStorage.forInstance(context.instance).load(req.params.itemGuid);
  if (!entity) {
    throw new NotFoundError("Item not found");
  }
  res.json({ item: await itemToJson(context.instance, entity) });
}));

itemsRouter.post("/instances/:instanceGuid/items", asyncRoute(async (req, res) => {
  const context = await assertInstancePermissions(req, PERMISSION_EDIT);
  const entity = await withTransaction(async () => {
    const storage = ItemStorage.forInstance(context.instance);
    const item = await storage.create();
    item.set(req.body);
    const validationErrors = await item.validate();
    if (validationErrors.length) {
      throw new ValidationError(validationErrors);
    }
    await item.save();
    return item;
  });
  res.status(201).json({ item: await itemToJson(context.instance, entity) });
}));

itemsRouter.put("/instances/:instanceGuid/items/:itemGuid", asyncRoute(async (req, res) => {
  const context = await assertInstancePermissions(req, PERMISSION_EDIT);
  const entity = await withTransaction(async () => {
    const storage = ItemStorage.forInstance(context.instance);
    const item = await storage.load(req.params.itemGuid);
    if (!item) {
      throw new NotFoundError("Item not found");
    }
    item.set(req.body);
    const validationErrors = await item.validate();
    if (validationErrors.length) {
      throw new ValidationError(validationErrors);
    }
    const saved = await item.save();
    if (!saved) {
      throw new NotFoundError("Item not found");
    }
    return item;
  });
  res.json({ item: await itemToJson(context.instance, entity) });
}));

itemsRouter.delete("/instances/:instanceGuid/items/:itemGuid", asyncRoute(async (req, res) => {
  const context = await assertInstancePermissions(req, PERMISSION_EDIT);
  await withTransaction(async () => {
    const storage = ItemStorage.forInstance(context.instance);
    const entity = await storage.load(req.params.itemGuid);
    if (!entity) {
      throw new NotFoundError("Item not found");
    }
    const deleted = await entity.delete();
    if (!deleted) {
      throw new NotFoundError("Item not found");
    }
  });
  res.status(204).send();
}));

module.exports = itemsRouter;
