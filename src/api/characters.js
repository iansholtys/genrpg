const express = require("express");
const { NotFoundError } = require("../errors/NotFoundError");
const { CharacterEntity, INSTANCE_FIELDS } = require("../entities/characterEntity");
const {
  PERMISSION_VIEW,
  PERMISSION_EDIT,
  assertInstancePermissions,
} = require("./instanceContext");
const { handleRouteError } = require("../lib/httpResponse");

const charactersRouter = express.Router();

function assertCharacterPermissions(req, permission) {
  return assertInstancePermissions(req, permission, { fields: INSTANCE_FIELDS });
}
charactersRouter.get("/instances/:instanceGuid/characters/form", async (req, res, next) => {
  try {
    const context = await assertCharacterPermissions(req, PERMISSION_VIEW);
    const metadata = await CharacterEntity.getFormSchema(context);
    res.json(metadata);
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

charactersRouter.get("/instances/:instanceGuid/characters", async (req, res, next) => {
  try {
    const context = await assertCharacterPermissions(req, PERMISSION_VIEW);
    const characters = await CharacterEntity.list(context);
    res.json({ characters });
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

charactersRouter.get("/instances/:instanceGuid/characters/:characterGuid", async (req, res, next) => {
  try {
    const context = await assertCharacterPermissions(req, PERMISSION_VIEW);
    const character = await CharacterEntity.load(context, req.params.characterGuid);
    if (!character) {
      throw new NotFoundError("Character not found");
    }
    res.json({ character });
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

charactersRouter.post("/instances/:instanceGuid/characters", async (req, res, next) => {
  try {
    const context = await assertCharacterPermissions(req, PERMISSION_EDIT);
    const character = await CharacterEntity.create(context, req.body);
    res.status(201).json({ character });
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

charactersRouter.patch(
  "/instances/:instanceGuid/characters/:characterGuid",
  async (req, res, next) => {
    try {
      const context = await assertCharacterPermissions(req, PERMISSION_EDIT);
      const character = await CharacterEntity.update(
        context,
        req.params.characterGuid,
        req.body,
      );
      if (!character) {
        throw new NotFoundError("Character not found");
      }
      res.json({ character });
    } catch (error) {
      handleRouteError(res, error, next);
    }
  },
);

charactersRouter.delete(
  "/instances/:instanceGuid/characters/:characterGuid",
  async (req, res, next) => {
    try {
      const context = await assertCharacterPermissions(req, PERMISSION_EDIT);
      const deleted = await CharacterEntity.delete(context, req.params.characterGuid);
      if (!deleted) {
        throw new NotFoundError("Character not found");
      }
      res.status(204).send();
    } catch (error) {
      handleRouteError(res, error, next);
    }
  },
);

module.exports = charactersRouter;
