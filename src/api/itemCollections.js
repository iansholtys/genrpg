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
const { handleRouteError } = require("../lib/httpResponse");
const { ItemCollectionEntity } = require("../entities/itemCollectionEntity");
const { ItemCollectionContentEntity } = require("../entities/itemCollectionContentEntity");
const ItemCollectionStorage = require("../storage/itemCollectionStorage");
const ItemCollectionContentStorage = require("../storage/itemCollectionContentStorage");

const itemCollectionsRouter = express.Router();

function parseOptionalUuid(value, fieldLabel) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return { error: `${fieldLabel} must be a string` };
  }
  return value.trim();
}

function parseItemCollectionListQuery(query) {
  const itemGuid = parseOptionalUuid(query.itemGuid, "Item");
  if (itemGuid?.error) {
    throw new BadRequestError(itemGuid.error);
  }

  const typeFilter =
    typeof query.type === "string" && query.type.trim() !== "" ? query.type.trim() : null;

  return { itemGuid, type: typeFilter };
}

async function assertCollectionExists(context, collectionGuid) {
  const collectionExists = await ItemCollectionStorage.forInstance(context.instance).exists(
    collectionGuid,
  );
  if (!collectionExists) {
    throw new NotFoundError("Item collection not found");
  }
}

function assertContentInCollection(entity, collectionGuid) {
  if (!entity || entity.collectionGuid !== collectionGuid) {
    throw new NotFoundError("Collection content not found");
  }
}

itemCollectionsRouter.get("/instances/:instanceGuid/item-collections/form", async (req, res, next) => {
  try {
    const context = await assertInstancePermissions(req, PERMISSION_VIEW);
    const metadata = await ItemCollectionEntity.getFormSchema(context);
    res.json(metadata);
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

itemCollectionsRouter.get("/instances/:instanceGuid/item-collections", async (req, res, next) => {
  try {
    const context = await assertInstancePermissions(req, PERMISSION_VIEW);
    const filters = parseItemCollectionListQuery(req.query);
    const entities = await ItemCollectionStorage.forInstance(context.instance).list(filters);
    res.json({ itemCollections: entities.map((entity) => entity.toJSON()) });
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

itemCollectionsRouter.get(
  "/instances/:instanceGuid/item-collections/:collectionGuid",
  async (req, res, next) => {
    try {
      const context = await assertInstancePermissions(req, PERMISSION_VIEW);
      const entity = await ItemCollectionStorage.forInstance(context.instance).load(
        req.params.collectionGuid,
      );
      if (!entity) {
        throw new NotFoundError("Item collection not found");
      }
      res.json({ itemCollection: entity.toJSON() });
    } catch (error) {
      handleRouteError(res, error, next);
    }
  },
);

itemCollectionsRouter.post("/instances/:instanceGuid/item-collections", async (req, res, next) => {
  try {
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
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

itemCollectionsRouter.put(
  "/instances/:instanceGuid/item-collections/:collectionGuid",
  async (req, res, next) => {
    try {
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
    } catch (error) {
      handleRouteError(res, error, next);
    }
  },
);

itemCollectionsRouter.delete(
  "/instances/:instanceGuid/item-collections/:collectionGuid",
  async (req, res, next) => {
    try {
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
    } catch (error) {
      handleRouteError(res, error, next);
    }
  },
);

itemCollectionsRouter.get(
  "/instances/:instanceGuid/item-collections/:collectionGuid/contents/form",
  async (req, res, next) => {
    try {
      const context = await assertInstancePermissions(req, PERMISSION_VIEW);
      const collectionGuid = req.params.collectionGuid;
      await assertCollectionExists(context, collectionGuid);
      const metadata = await ItemCollectionContentEntity.getFormSchema(context, { collectionGuid });
      res.json(metadata);
    } catch (error) {
      handleRouteError(res, error, next);
    }
  },
);

itemCollectionsRouter.get(
  "/instances/:instanceGuid/item-collections/:collectionGuid/contents",
  async (req, res, next) => {
    try {
      const context = await assertInstancePermissions(req, PERMISSION_VIEW);
      const collectionGuid = req.params.collectionGuid;
      await assertCollectionExists(context, collectionGuid);
      const entities = await ItemCollectionContentStorage.forInstance(context.instance).list({
        collectionGuid,
      });
      res.json({ contents: entities.map((entity) => entity.toJSON()) });
    } catch (error) {
      handleRouteError(res, error, next);
    }
  },
);

itemCollectionsRouter.get(
  "/instances/:instanceGuid/item-collections/:collectionGuid/contents/:contentGuid",
  async (req, res, next) => {
    try {
      const context = await assertInstancePermissions(req, PERMISSION_VIEW);
      const collectionGuid = req.params.collectionGuid;
      const entity = await ItemCollectionContentStorage.forInstance(context.instance).load(
        req.params.contentGuid,
      );
      assertContentInCollection(entity, collectionGuid);
      res.json({ content: entity.toJSON() });
    } catch (error) {
      handleRouteError(res, error, next);
    }
  },
);

itemCollectionsRouter.post(
  "/instances/:instanceGuid/item-collections/:collectionGuid/contents",
  async (req, res, next) => {
    try {
      const context = await assertInstancePermissions(req, PERMISSION_EDIT);
      const collectionGuid = req.params.collectionGuid;
      await assertCollectionExists(context, collectionGuid);
      const content = await withTransaction(async () => {
        const storage = ItemCollectionContentStorage.forInstance(context.instance);
        const entity = await storage.create({ collectionGuid });
        entity.set(req.body);
        const validationErrors = await entity.validate();
        if (validationErrors.length) {
          throw new ValidationError(validationErrors);
        }
        await entity.save();
        return entity.toJSON();
      });
      res.status(201).json({ content });
    } catch (error) {
      handleRouteError(res, error, next);
    }
  },
);

itemCollectionsRouter.put(
  "/instances/:instanceGuid/item-collections/:collectionGuid/contents/:contentGuid",
  async (req, res, next) => {
    try {
      const context = await assertInstancePermissions(req, PERMISSION_EDIT);
      const collectionGuid = req.params.collectionGuid;
      const content = await withTransaction(async () => {
        const storage = ItemCollectionContentStorage.forInstance(context.instance);
        const entity = await storage.load(req.params.contentGuid);
        assertContentInCollection(entity, collectionGuid);
        entity.set(req.body);
        const validationErrors = await entity.validate();
        if (validationErrors.length) {
          throw new ValidationError(validationErrors);
        }
        await entity.save();
        return entity.toJSON();
      });
      res.json({ content });
    } catch (error) {
      handleRouteError(res, error, next);
    }
  },
);

itemCollectionsRouter.delete(
  "/instances/:instanceGuid/item-collections/:collectionGuid/contents/:contentGuid",
  async (req, res, next) => {
    try {
      const context = await assertInstancePermissions(req, PERMISSION_EDIT);
      const collectionGuid = req.params.collectionGuid;
      await withTransaction(async () => {
        const storage = ItemCollectionContentStorage.forInstance(context.instance);
        const entity = await storage.load(req.params.contentGuid);
        assertContentInCollection(entity, collectionGuid);
        const deleted = await entity.delete();
        if (!deleted) {
          throw new NotFoundError("Collection content not found");
        }
      });
      res.status(204).send();
    } catch (error) {
      handleRouteError(res, error, next);
    }
  },
);

module.exports = itemCollectionsRouter;
