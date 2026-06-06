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
const { InventoryEntity } = require("../entities/inventoryEntity");
const InventoryStorage = require("../storage/inventoryStorage");

const inventoriesRouter = express.Router();

function parseOptionalUuid(value, fieldLabel) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return { error: `${fieldLabel} must be a string` };
  }
  return value.trim();
}

function parseInventoryListQuery(query) {
  const characterGuid = parseOptionalUuid(query.characterGuid, "Character");
  if (characterGuid?.error) {
    throw new BadRequestError(characterGuid.error);
  }

  const collectionGuid = parseOptionalUuid(query.collectionGuid, "Collection");
  if (collectionGuid?.error) {
    throw new BadRequestError(collectionGuid.error);
  }

  return { characterGuid, collectionGuid };
}

inventoriesRouter.get("/instances/:instanceGuid/inventories/form", async (req, res, next) => {
  try {
    const context = await assertInstancePermissions(req, PERMISSION_VIEW);
    const metadata = await InventoryEntity.getFormSchema(context);
    res.json(metadata);
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

inventoriesRouter.get("/instances/:instanceGuid/inventories", async (req, res, next) => {
  try {
    const context = await assertInstancePermissions(req, PERMISSION_VIEW);
    const filters = parseInventoryListQuery(req.query);
    const entities = await InventoryStorage.forInstance(context.instance).list(filters);
    res.json({ inventories: entities.map((entity) => entity.toJSON()) });
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

inventoriesRouter.get("/instances/:instanceGuid/inventories/:inventoryGuid", async (req, res, next) => {
  try {
    const context = await assertInstancePermissions(req, PERMISSION_VIEW);
    const entity = await InventoryStorage.forInstance(context.instance).load(
      req.params.inventoryGuid,
    );
    if (!entity) {
      throw new NotFoundError("Inventory not found");
    }
    res.json({ inventory: entity.toJSON() });
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

inventoriesRouter.post("/instances/:instanceGuid/inventories", async (req, res, next) => {
  try {
    const context = await assertInstancePermissions(req, PERMISSION_EDIT);
    const inventory = await withTransaction(async () => {
      const entity = await InventoryStorage.forInstance(context.instance).create();
      entity.set(req.body);
      const validationErrors = await entity.validate();
      if (validationErrors.length) {
        throw new ValidationError(validationErrors);
      }
      await entity.save();
      return entity.toJSON();
    });
    res.status(201).json({ inventory });
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

inventoriesRouter.put("/instances/:instanceGuid/inventories/:inventoryGuid", async (req, res, next) => {
  try {
    const context = await assertInstancePermissions(req, PERMISSION_EDIT);
    const inventory = await withTransaction(async () => {
      const entity = await InventoryStorage.forInstance(context.instance).load(
        req.params.inventoryGuid,
      );
      if (!entity) {
        throw new NotFoundError("Inventory not found");
      }
      entity.set(req.body);
      const validationErrors = await entity.validate();
      if (validationErrors.length) {
        throw new ValidationError(validationErrors);
      }
      const saved = await entity.save();
      if (!saved) {
        throw new NotFoundError("Inventory not found");
      }
      return entity.toJSON();
    });
    res.json({ inventory });
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

inventoriesRouter.delete(
  "/instances/:instanceGuid/inventories/:inventoryGuid",
  async (req, res, next) => {
    try {
      const context = await assertInstancePermissions(req, PERMISSION_EDIT);
      await withTransaction(async () => {
        const storage = InventoryStorage.forInstance(context.instance);
        const entity = await storage.load(req.params.inventoryGuid);
        if (!entity) {
          throw new NotFoundError("Inventory not found");
        }
        const deleted = await entity.delete();
        if (!deleted) {
          throw new NotFoundError("Inventory not found");
        }
      });
      res.status(204).send();
    } catch (error) {
      handleRouteError(res, error, next);
    }
  },
);

module.exports = inventoriesRouter;
