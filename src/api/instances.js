const crypto = require("node:crypto");
const express = require("express");
const { pool } = require("../db/pool");
const { withTransaction, getTransactionClient } = require("../db/transactionContext");
const { deleteQuery, insertQuery, updateQuery, selectQuery, qualify } = require("../services/queryService");
const { applyInstallForInstance } = require("../install");
const { isGlobalAdmin } = require("../auth");
const {
  loadAccessibleInstance,
  getUserInstanceRole,
  userHasPermission,
} = require("../services/permissionService");
const { asyncRoute } = require("../lib/httpResponse");
const {
  loadPackages,
  parsePackageCsv,
  validatePackageSelection,
  resolveInstanceAssetsForRequest,
} = require("../packages");
const UserStorage = require("../storage/userStorage");
const {
  createDefaultInstanceAlias,
  createCustomInstanceAlias,
  deleteAliasesForInstance,
  lookupCustomInstanceUrlSegment,
  syncCustomInstanceAlias,
  slugifyInstanceUrlSegment,
} = require("../aliases");

const instancesRouter = express.Router();

// Resolves instance package assets from the in-memory package cache (no per-request YAML I/O).
instancesRouter.get("/instances/:guid/assets", asyncRoute(async (req, res) => {
  const instanceGuid = req.params.guid;
  const user = req.session.user;

  const instance = await loadAccessibleInstance(instanceGuid, user, {
    fields: ["guid", "name", "description", "packages"],
  });
  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  // Must have the run permission to load game assets
  const canRun = await userHasPermission(user.guid, instanceGuid, "instance.run");
  if (!canRun) {
    res.status(403).json({ error: "You do not have permission to run this instance" });
    return;
  }

  const packageNames = parsePackageCsv(instance.packages);
  const packages = await loadPackages({ strict: true });
  const assets = await resolveInstanceAssetsForRequest(packageNames, packages);

  res.json({
    css: assets.css,
    js: assets.js,
    packageNames: assets.packageNames,
    packages: assets.packages,
  });
}));

instancesRouter.get("/instances", async (req, res, next) => {
  try {
    const user = req.session.user;
    const isAdmin = await isGlobalAdmin(user.guid);
    const result = await pool.query(
      `
        SELECT
          i.guid,
          i.name,
          i.description,
          i.packages,
          i.create_datetime,
          i.update_datetime,
          CASE
            WHEN $2::boolean THEN 'Admin'
            ELSE r.name
          END AS role,
          CASE
            WHEN $2::boolean THEN true
            ELSE EXISTS (
              SELECT 1 FROM genrpg.role_permissions rp
              JOIN genrpg.permissions p ON p.id = rp.permission_id
              WHERE rp.role_id = iur.role_id AND p.name = 'instance.manage_users'
            )
          END AS can_manage_users,
          CASE
            WHEN $2::boolean THEN true
            ELSE EXISTS (
              SELECT 1 FROM genrpg.role_permissions rp
              JOIN genrpg.permissions p ON p.id = rp.permission_id
              WHERE rp.role_id = iur.role_id AND p.name = 'instance.delete'
            )
          END AS can_delete,
          CASE
            WHEN $2::boolean THEN true
            ELSE EXISTS (
              SELECT 1 FROM genrpg.role_permissions rp
              JOIN genrpg.permissions p ON p.id = rp.permission_id
              WHERE rp.role_id = iur.role_id AND p.name = 'instance.edit'
            )
          END AS can_edit,
          (
            SELECT NULLIF(
              regexp_replace(ua.alias, '^instance/', ''),
              i.guid::text
            )
            FROM genrpg.url_aliases ua
            WHERE ua.path = 'instance:' || i.guid::text
              AND ua.alias <> 'instance/' || i.guid::text
            ORDER BY length(ua.alias) ASC, ua.alias ASC
            LIMIT 1
          ) AS url_segment
        FROM genrpg.instances i
        LEFT JOIN genrpg.instance_user_roles iur
          ON iur.instance_guid = i.guid
          AND iur.user_guid = $1
        LEFT JOIN genrpg.roles r ON r.id = iur.role_id
        WHERE $2::boolean OR iur.user_guid IS NOT NULL
        ORDER BY i.update_datetime DESC
      `,
      [user.guid, isAdmin],
    );

    res.json({
      instances: result.rows.map((instance) => ({
        ...instance,
        packageNames: parsePackageCsv(instance.packages),
      })),
    });
  } catch (error) {
    next(error);
  }
});

instancesRouter.post("/instances", asyncRoute(async (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const description =
    typeof req.body.description === "string" ? req.body.description.trim() : "";
  const selectedPackages = Array.isArray(req.body.packages) ? req.body.packages : null;
  const rawUrl = typeof req.body.url === "string" ? req.body.url.trim() : "";
  const urlSegment = rawUrl ? slugifyInstanceUrlSegment(rawUrl) : "";

  if (!name) {
    res.status(400).json({ error: "Instance name is required" });
    return;
  }

  if (rawUrl && !urlSegment) {
    res.status(400).json({ error: "Instance URL is invalid" });
    return;
  }

  if (!selectedPackages) {
    res.status(400).json({ error: "Packages are required" });
    return;
  }

  const packages = await loadPackages({ strict: true });
  const packageSelection = validatePackageSelection(selectedPackages, packages);
  if (!packageSelection.valid) {
    res.status(400).json({ error: "Invalid package selection", details: packageSelection.details });
    return;
  }

  const instanceGuid = crypto.randomUUID();

  const instanceRow = await withTransaction(async () => {
    const client = getTransactionClient();
    const instanceInsert = insertQuery()
      .into("genrpg", "instances")
      .values(
        ["guid", "name", "description", "packages"],
        [instanceGuid, name, description, packageSelection.packageCsv],
      )
      .returning(null, [
        "guid",
        "name",
        "description",
        "packages",
        "create_datetime",
        "update_datetime",
      ]);

    const instance = await client.query(instanceInsert.toString(), instanceInsert.params);

    // Assign Instance_Owner role to the creator
    const roleTableAlias = "r";
    const ownerRoleQuery = selectQuery()
      .from("genrpg", "roles", roleTableAlias)
      .addFields(roleTableAlias, "id")
      .whereColumn(roleTableAlias, "name", "Instance_Owner");

    const ownerRole = await client.query(ownerRoleQuery.toString(), ownerRoleQuery.params);
    if (ownerRole.rows.length > 0) {
      const ownerRoleInsert = insertQuery()
        .into("genrpg", "instance_user_roles")
        .values(
          ["instance_guid", "user_guid", "role_id"],
          [instanceGuid, req.session.user.guid, ownerRole.rows[0].id],
        );

      await client.query(ownerRoleInsert.toString(), ownerRoleInsert.params);
    }

    await createDefaultInstanceAlias(client, instanceGuid);
    if (urlSegment) {
      await createCustomInstanceAlias(client, instanceGuid, urlSegment);
    }

    await applyInstallForInstance(instanceGuid, packageSelection.packageCsv);

    return instance.rows[0];
  });

  res.status(201).json({
    instance: {
      ...instanceRow,
      packageNames: parsePackageCsv(instanceRow.packages),
      role: await isGlobalAdmin(req.session.user.guid) ? "Admin" : "Instance_Owner",
      can_manage_users: true,
      can_delete: true,
    },
  });
}));

instancesRouter.put("/instances/:guid", async (req, res, next) => {
  try {
    const user = req.session.user;
    const instanceGuid = req.params.guid;
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const description =
      typeof req.body.description === "string" ? req.body.description.trim() : "";
    const rawUrl = typeof req.body.url === "string" ? req.body.url.trim() : "";
    const urlSegment = rawUrl ? slugifyInstanceUrlSegment(rawUrl) : "";

    if (!name) {
      res.status(400).json({ error: "Instance name is required" });
      return;
    }

    if (rawUrl && !urlSegment) {
      res.status(400).json({ error: "Instance URL is invalid" });
      return;
    }

    const canEdit = await userHasPermission(user.guid, instanceGuid, "instance.edit");
    if (!canEdit) {
      res.status(403).json({ error: "You do not have permission to edit this instance" });
      return;
    }

    const instance = await loadAccessibleInstance(instanceGuid, user, {
      fields: ["guid", "name", "description", "packages"],
    });
    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    const currentUrlSegment = await lookupCustomInstanceUrlSegment(instanceGuid);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const tableAlias = "i";
      const updateInstanceQuery = updateQuery()
        .from("genrpg", "instances", tableAlias)
        .set(["name", "description"], [name, description])
        .whereColumn(tableAlias, "guid", instanceGuid)
        .returning(tableAlias, [
          "guid",
          "name",
          "description",
          "packages",
          "create_datetime",
          "update_datetime",
        ]);

      const updated = await client.query(updateInstanceQuery.toString(), updateInstanceQuery.params);

      if (urlSegment !== currentUrlSegment) {
        await syncCustomInstanceAlias(client, instanceGuid, urlSegment);
      }

      await client.query("COMMIT");

      const row = updated.rows[0];
      const resolvedUrlSegment = await lookupCustomInstanceUrlSegment(instanceGuid);

      res.json({
        instance: {
          ...row,
          packageNames: parsePackageCsv(row.packages),
          url_segment: resolvedUrlSegment || null,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

instancesRouter.get("/instances/:guid/users", async (req, res, next) => {
  try {
    const user = req.session.user;
    const instanceGuid = req.params.guid;

    // Must have access to the instance
    const instance = await loadAccessibleInstance(instanceGuid, user, {
      fields: ["guid", "name", "description", "packages"],
    });
    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    const users = await UserStorage.global().listForInstance(instanceGuid);

    res.json({
      users: users.map((entity) => ({
        guid: entity.guid,
        email: entity.email,
        displayName: entity.displayName,
        roleId: entity.instanceRoles[0]?.roleId ?? null,
        roleName: entity.instanceRoles[0]?.roleName ?? null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

instancesRouter.put("/instances/:guid/users/:userGuid", async (req, res, next) => {
  try {
    const user = req.session.user;
    const { guid: instanceGuid, userGuid: targetUserGuid } = req.params;
    const { roleId } = req.body;

    if (!roleId) {
      res.status(400).json({ error: "roleId is required" });
      return;
    }

    // Check manage_users permission
    const canManage = await userHasPermission(user.guid, instanceGuid, "instance.manage_users");
    if (!canManage) {
      res.status(403).json({ error: "You do not have permission to manage users on this instance" });
      return;
    }

    // Verify the role exists
    const roleTableAlias = "r";
    const roleLookupQuery = selectQuery()
      .from("genrpg", "roles", roleTableAlias)
      .addFields(roleTableAlias, ["id", "name"])
      .whereColumn(roleTableAlias, "id", roleId);

    const roleResult = await pool.query(roleLookupQuery.toString(), roleLookupQuery.params);
    if (!roleResult.rows.length) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }

    const roleName = roleResult.rows[0].name;

    // GMs cannot assign Instance_Owner
    const isAdmin = await isGlobalAdmin(user.guid);
    if (!isAdmin) {
      const callerRole = await getUserInstanceRole(instanceGuid, user.guid);
      if (callerRole === "Instance_GM" && roleName === "Instance_Owner") {
        res.status(403).json({ error: "GMs cannot assign the Instance_Owner role" });
        return;
      }
    }

    const roleAssignment = insertQuery()
      .into("genrpg", "instance_user_roles")
      .values(["instance_guid", "user_guid", "role_id"], [instanceGuid, targetUserGuid, roleId])
      .onConflict(["instance_guid", "user_guid"], "DO UPDATE");

    await pool.query(roleAssignment.toString(), roleAssignment.params);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

instancesRouter.delete("/instances/:guid/users/:userGuid", async (req, res, next) => {
  try {
    const user = req.session.user;
    const { guid: instanceGuid, userGuid: targetUserGuid } = req.params;

    // Check manage_users permission
    const canManage = await userHasPermission(user.guid, instanceGuid, "instance.manage_users");
    if (!canManage) {
      res.status(403).json({ error: "You do not have permission to manage users on this instance" });
      return;
    }

    // GMs cannot remove Instance_Owners
    const isAdmin = await isGlobalAdmin(user.guid);
    if (!isAdmin) {
      const callerRole = await getUserInstanceRole(instanceGuid, user.guid);
      const targetRole = await getUserInstanceRole(instanceGuid, targetUserGuid);
      if (callerRole === "Instance_GM" && targetRole === "Instance_Owner") {
        res.status(403).json({ error: "GMs cannot remove Instance_Owner users" });
        return;
      }
    }

    const tableAlias = "r";
    const removeRoleQuery = deleteQuery()
      .from("genrpg", "instance_user_roles", tableAlias)
      .whereColumn(tableAlias, "instance_guid", instanceGuid)
      .whereColumn(tableAlias, "user_guid", targetUserGuid);

    await pool.query(removeRoleQuery.toString(), removeRoleQuery.params);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

instancesRouter.delete("/instances/:guid", async (req, res, next) => {
  try {
    const user = req.session.user;
    const instanceGuid = req.params.guid;
    const { confirmName } = req.body;

    // Check delete permission
    const canDelete = await userHasPermission(user.guid, instanceGuid, "instance.delete");
    if (!canDelete) {
      res.status(403).json({ error: "You do not have permission to delete this instance" });
      return;
    }

    // Verify the instance exists and get name for confirmation
    const instance = await loadAccessibleInstance(instanceGuid, user, {
      fields: ["guid", "name", "description", "packages"],
    });
    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    // Require name confirmation
    if (!confirmName || confirmName !== instance.name) {
      res.status(400).json({ error: "Instance name confirmation does not match" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await deleteAliasesForInstance(client, instanceGuid);
      const tableAlias = "i";
      const deleteInstanceQuery = deleteQuery()
        .from("genrpg", "instances", tableAlias)
        .whereColumn(tableAlias, "guid", instanceGuid);

      await client.query(deleteInstanceQuery.toString(), deleteInstanceQuery.params);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = instancesRouter;
