const express = require("express");
const { pool } = require("../db/pool");
const { requireAdmin } = require("../auth");

const rolesRouter = express.Router();

rolesRouter.get("/roles", async (req, res, next) => {
  try {
    const rolesResult = await pool.query(
      `SELECT id, name, description FROM genrpg.roles ORDER BY id`,
    );
    const rpResult = await pool.query(
      `
        SELECT rp.role_id, p.id AS permission_id, p.name AS permission_name
        FROM genrpg.role_permissions rp
        JOIN genrpg.permissions p ON p.id = rp.permission_id
        ORDER BY rp.role_id, p.id
      `,
    );
    const permissionsByRole = new Map();
    for (const row of rpResult.rows) {
      if (!permissionsByRole.has(row.role_id)) {
        permissionsByRole.set(row.role_id, []);
      }
      permissionsByRole.get(row.role_id).push({
        id: row.permission_id,
        name: row.permission_name,
      });
    }
    const roles = rolesResult.rows.map((role) => ({
      ...role,
      permissions: permissionsByRole.get(role.id) || [],
    }));
    res.json({ roles });
  } catch (error) {
    next(error);
  }
});

rolesRouter.get("/permissions", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description FROM genrpg.permissions ORDER BY id`,
    );
    res.json({ permissions: result.rows });
  } catch (error) {
    next(error);
  }
});

rolesRouter.post("/roles", requireAdmin, async (req, res, next) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const description =
      typeof req.body.description === "string" ? req.body.description.trim() : "";
    const permissionIds = Array.isArray(req.body.permissionIds) ? req.body.permissionIds : [];

    if (!name) {
      res.status(400).json({ error: "Role name is required" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const roleResult = await client.query(
        `INSERT INTO genrpg.roles (name, description) VALUES ($1, $2) RETURNING id, name, description`,
        [name, description],
      );
      const roleId = roleResult.rows[0].id;

      if (permissionIds.length > 0) {
        const values = permissionIds.map((pid, i) => `($1, $${i + 2})`).join(", ");
        await client.query(
          `INSERT INTO genrpg.role_permissions (role_id, permission_id) VALUES ${values} ON CONFLICT DO NOTHING`,
          [roleId, ...permissionIds],
        );
      }

      await client.query("COMMIT");
      res.status(201).json({ role: roleResult.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        res.status(400).json({ error: `A role named "${name}" already exists` });
        return;
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

rolesRouter.put("/roles/:id", requireAdmin, async (req, res, next) => {
  try {
    const roleId = Number(req.params.id);
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const description =
      typeof req.body.description === "string" ? req.body.description.trim() : "";
    const permissionIds = Array.isArray(req.body.permissionIds) ? req.body.permissionIds : [];

    if (!name) {
      res.status(400).json({ error: "Role name is required" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const roleResult = await client.query(
        `UPDATE genrpg.roles SET name = $1, description = $2 WHERE id = $3 RETURNING id, name, description`,
        [name, description, roleId],
      );
      if (!roleResult.rows.length) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Role not found" });
        return;
      }

      // Replace all permissions for this role
      await client.query(
        `DELETE FROM genrpg.role_permissions WHERE role_id = $1`,
        [roleId],
      );
      if (permissionIds.length > 0) {
        const values = permissionIds.map((pid, i) => `($1, $${i + 2})`).join(", ");
        await client.query(
          `INSERT INTO genrpg.role_permissions (role_id, permission_id) VALUES ${values} ON CONFLICT DO NOTHING`,
          [roleId, ...permissionIds],
        );
      }

      await client.query("COMMIT");
      res.json({ role: roleResult.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        res.status(400).json({ error: `A role named "${name}" already exists` });
        return;
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

rolesRouter.delete("/roles/:id", requireAdmin, async (req, res, next) => {
  try {
    const roleId = Number(req.params.id);

    // Prevent deleting roles that are in use
    const usageResult = await pool.query(
      `SELECT COUNT(*) AS count FROM genrpg.instance_user_roles WHERE role_id = $1`,
      [roleId],
    );
    if (Number(usageResult.rows[0].count) > 0) {
      res.status(400).json({
        error: "Cannot delete this role because it is assigned to users on one or more instances",
      });
      return;
    }

    const result = await pool.query(
      `DELETE FROM genrpg.roles WHERE id = $1 RETURNING id`,
      [roleId],
    );
    if (!result.rows.length) {
      res.status(404).json({ error: "Role not found" });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = rolesRouter;
