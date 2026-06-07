const express = require("express");
const { NotFoundError } = require("../errors/NotFoundError");
const { ValidationError } = require("../errors/ValidationError");
const { withTransaction } = require("../db/transactionContext");
const { requireAdmin } = require("../auth");
const UserStorage = require("../storage/userStorage");
const { handleRouteError } = require("../lib/httpResponse");

const usersRouter = express.Router();

usersRouter.get("/me", async (req, res, next) => {
  try {
    if (req.session.user) {
      const entity = await UserStorage.global().load(req.session.user.guid);
      if (entity) {
        req.session.user = entity.toJSON();
      }
    }
    res.json({ user: req.session.user });
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

usersRouter.get("/users", async (req, res, next) => {
  try {
    const users = (await UserStorage.global().list()).map((entity) => entity.toJSON());
    res.json({ users });
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

usersRouter.put("/users/:guid/admin", requireAdmin, async (req, res, next) => {
  try {
    const targetGuid = req.params.guid;
    const { admin } = req.body;

    // Prevent removing your own admin access
    if (targetGuid === req.session.user.guid && admin === false) {
      res.status(403).json({ error: "You cannot demote yourself" });
      return;
    }

    await withTransaction(async () => {
      const storage = UserStorage.global();
      const entity = await storage.load(targetGuid);
      if (!entity) {
        throw new NotFoundError("User not found");
      }

      entity.set({ admin: !!admin });
      const validationErrors = await entity.validate();
      if (validationErrors.length) {
        throw new ValidationError(validationErrors);
      }

      const saved = await entity.save();
      if (!saved) {
        throw new NotFoundError("User not found");
      }
    });

    res.json({ success: true });
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

usersRouter.delete("/users/:guid", requireAdmin, async (req, res, next) => {
  try {
    const targetGuid = req.params.guid;

    // Prevent deleting yourself
    if (targetGuid === req.session.user.guid) {
      res.status(403).json({ error: "You cannot delete yourself" });
      return;
    }

    await withTransaction(async () => {
      const storage = UserStorage.global();
      const entity = await storage.load(targetGuid);
      if (!entity) {
        throw new NotFoundError("User not found");
      }

      const deleted = await entity.delete({ skipEvents: true });
      if (!deleted) {
        throw new NotFoundError("User not found");
      }
    });

    res.status(204).send();
  } catch (error) {
    handleRouteError(res, error, next);
  }
});

module.exports = usersRouter;
