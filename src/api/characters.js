const express = require("express");
const { NotFoundError } = require("../errors/NotFoundError");
const { ValidationError } = require("../errors/ValidationError");
const { withTransaction } = require("../db/transactionContext");
const CharacterEntity = require("../../genrpg/entities/character");
const CharacterStorage = require("../../genrpg/storage/characterStorage");
const {
  PERMISSION_VIEW,
  PERMISSION_EDIT,
  assertInstancePermissions,
} = require("./instanceContext");
const { asyncRoute } = require("../lib/httpResponse");

const charactersRouter = express.Router();

charactersRouter.get("/instances/:instanceGuid/characters/form", asyncRoute(async (req, res) => {
  const context = await assertInstancePermissions(req, PERMISSION_VIEW);
  const metadata = await CharacterEntity.getFormSchema(context);
  res.json(metadata);
}));

charactersRouter.get("/instances/:instanceGuid/characters", asyncRoute(async (req, res) => {
  const context = await assertInstancePermissions(req, PERMISSION_VIEW);
  const storage = CharacterStorage.forInstance(context.instance);
  const characters = (await storage.list()).map((entity) => entity.toJSON());
  res.json({ characters });
}));

charactersRouter.get("/instances/:instanceGuid/characters/:characterGuid", asyncRoute(async (req, res) => {
  const context = await assertInstancePermissions(req, PERMISSION_VIEW);
  const storage = CharacterStorage.forInstance(context.instance);
  const entity = await storage.load(req.params.characterGuid);
  if (!entity) {
    throw new NotFoundError("Character not found");
  }
  res.json({ character: entity.toJSON() });
}));

charactersRouter.post("/instances/:instanceGuid/characters", asyncRoute(async (req, res) => {
  const context = await assertInstancePermissions(req, PERMISSION_EDIT);
  const character = await withTransaction(async () => {
    const storage = CharacterStorage.forInstance(context.instance);
    const entity = await storage.create();
    entity.set({ userGuid: context.user.guid, ...req.body });
    const validationErrors = await entity.validate();
    if (validationErrors.length) {
      throw new ValidationError(validationErrors);
    }
    await entity.save();
    return entity.toJSON();
  });
  res.status(201).json({ character });
}));

charactersRouter.put(
  "/instances/:instanceGuid/characters/:characterGuid",
  asyncRoute(async (req, res) => {
    const context = await assertInstancePermissions(req, PERMISSION_EDIT);
    const character = await withTransaction(async () => {
      const storage = CharacterStorage.forInstance(context.instance);
      const entity = await storage.load(req.params.characterGuid);
      if (!entity) {
        throw new NotFoundError("Character not found");
      }
      entity.set(req.body);
      const validationErrors = await entity.validate();
      if (validationErrors.length) {
        throw new ValidationError(validationErrors);
      }
      const saved = await entity.save();
      if (!saved) {
        throw new NotFoundError("Character not found");
      }
      return entity.toJSON();
    });
    res.json({ character });
  }),
);

charactersRouter.delete(
  "/instances/:instanceGuid/characters/:characterGuid",
  asyncRoute(async (req, res) => {
    const context = await assertInstancePermissions(req, PERMISSION_EDIT);
    await withTransaction(async () => {
      const storage = CharacterStorage.forInstance(context.instance);
      const entity = await storage.load(req.params.characterGuid);
      if (!entity) {
        throw new NotFoundError("Character not found");
      }
      const deleted = await entity.delete();
      if (!deleted) {
        throw new NotFoundError("Character not found");
      }
    });
    res.status(204).send();
  }),
);

module.exports = charactersRouter;
