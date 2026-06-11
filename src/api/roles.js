const express = require("express");
const { pool } = require("../db/pool");
const { requireAdmin } = require("../auth");
const {
  deleteQuery,
  insertQuery,
  qualify,
  selectQuery,
  updateQuery,
} = require("../services/queryService");

const rolesRouter = express.Router();

function rolePermissionInsertQuery(roleId, permissionIds) {
  if (!permissionIds.length) {
    return null;
  }

  return insertQuery()
    .into("genrpg", "role_permissions")
    .values(["role_id", "permission_id"],
      ...permissionIds.map((permissionId) => [roleId, permissionId]),
    )
    .onConflict([], "DO NOTHING");
}

rolesRouter.get("/roles", async (req, res, next) => {
  try {
    const roleAlias = "r";
    const rolesQuery = selectQuery()
      .from("genrpg", "roles", roleAlias)
      .addFields(roleAlias, ["id", "name", "description"])
      .orderBy(roleAlias, "id");

    const rolePermissionAlias = "rp";
    const permissionAlias = "p";
    const permissionsQuery = selectQuery()
      .from("genrpg", "role_permissions", rolePermissionAlias)
      .addFields(rolePermissionAlias, "role_id")
      .addJoin(
        "genrpg",
        "permissions",
        permissionAlias,
        `${qualify(permissionAlias, "id")} = ${qualify(rolePermissionAlias, "permission_id")}`,
      )
      .addFields(permissionAlias, ["id", "name"], ["permission_id", "permission_name"])
      .orderBy(rolePermissionAlias, "role_id")
      .orderBy(permissionAlias, "id");

    const rolesResult = await pool.query(rolesQuery.toString(), rolesQuery.params);
    const rpResult = await pool.query(permissionsQuery.toString(), permissionsQuery.params);
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
    const tableAlias = "p";
    const query = selectQuery()
      .from("genrpg", "permissions", tableAlias)
      .addFields(tableAlias, ["id", "name", "description"])
      .orderBy(tableAlias, "id");

    const result = await pool.query(query.toString(), query.params);
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
      const createRoleQuery = insertQuery()
        .into("genrpg", "roles")
        .values(["name", "description"], [name, description])
        .returning(null, ["id", "name", "description"]);

      const roleResult = await client.query(createRoleQuery.toString(), createRoleQuery.params);
      const roleId = roleResult.rows[0].id;

      const permissionInsert = rolePermissionInsertQuery(roleId, permissionIds);
      if (permissionInsert) {
        await client.query(permissionInsert.toString(), permissionInsert.params);
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
      const tableAlias = "r";
      const updateRoleQuery = updateQuery()
        .from("genrpg", "roles", tableAlias)
        .set(["name", "description"], [name, description])
        .whereColumn(tableAlias, "id", roleId)
        .returning(tableAlias, ["id", "name", "description"]);

      const roleResult = await client.query(updateRoleQuery.toString(), updateRoleQuery.params);
      if (!roleResult.rows.length) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Role not found" });
        return;
      }

      // Replace all permissions for this role
      const deletePermissionsQuery = deleteQuery()
        .from("genrpg", "role_permissions", "rp")
        .whereColumn("rp", "role_id", roleId);

      await client.query(deletePermissionsQuery.toString(), deletePermissionsQuery.params);
      const permissionInsert = rolePermissionInsertQuery(roleId, permissionIds);
      if (permissionInsert) {
        await client.query(permissionInsert.toString(), permissionInsert.params);
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
    const tableAlias = "iur";
    const usageQuery = selectQuery()
      .from("genrpg", "instance_user_roles", tableAlias)
      .addExpression("COUNT(*)", "count")
      .whereColumn(tableAlias, "role_id", roleId);

    const usageResult = await pool.query(usageQuery.toString(), usageQuery.params);
    if (Number(usageResult.rows[0].count) > 0) {
      res.status(400).json({
        error: "Cannot delete this role because it is assigned to users on one or more instances",
      });
      return;
    }

    const roleAlias = "r";
    const deleteRoleQuery = deleteQuery()
      .from("genrpg", "roles", roleAlias)
      .whereColumn(roleAlias, "id", roleId)
      .returning(roleAlias, "id");

    const result = await pool.query(deleteRoleQuery.toString(), deleteRoleQuery.params);
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
