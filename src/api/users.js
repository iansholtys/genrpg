const express = require("express");
const { pool } = require("../db/pool");
const { requireAdmin, userSummary } = require("../auth");

const usersRouter = express.Router();

usersRouter.get("/me", async (req, res, next) => {
  try {
    if (req.session.user) {
      // Keep session fresh so UI updates immediately upon promotion/demotion
      const result = await pool.query(
        `SELECT guid, email, display_name, admin FROM genrpg.users WHERE guid = $1`,
        [req.session.user.guid]
      );
      if (result.rows.length) {
        req.session.user = userSummary(result.rows[0]);
      }
    }
    res.json({ user: req.session.user });
  } catch (error) {
    next(error);
  }
});

usersRouter.get("/users", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT guid, email, display_name, admin FROM genrpg.users ORDER BY display_name`,
    );
    res.json({ users: result.rows.map(userSummary) });
  } catch (error) {
    next(error);
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

    const result = await pool.query(
      `UPDATE genrpg.users SET admin = $1 WHERE guid = $2 RETURNING guid`,
      [!!admin, targetGuid],
    );

    if (!result.rows.length) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
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

    const result = await pool.query(
      `DELETE FROM genrpg.users WHERE guid = $1 RETURNING guid`,
      [targetGuid],
    );

    if (!result.rows.length) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = usersRouter;
