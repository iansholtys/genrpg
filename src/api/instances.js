const crypto = require("node:crypto");
const express = require("express");
const { pool } = require("../db/pool");
const { isGlobalAdmin } = require("../auth");
const {
  PackageLoadError,
  loadPackages,
  parsePackageCsv,
  validatePackageSelection,
  resolveInstanceAssetsForRequest,
} = require("../packages");
const {
  createDefaultInstanceAlias,
  createCustomInstanceAlias,
  deleteAliasesForInstance,
  lookupCustomInstanceUrlSegment,
  syncCustomInstanceAlias,
  slugifyInstanceUrlSegment,
} = require("../aliases");

const instancesRouter = express.Router();

async function loadAccessibleInstance(instanceGuid, user) {
  const isAdmin = await isGlobalAdmin(user.guid);
  const result = await pool.query(
    `
      SELECT
        i.guid,
        i.name,
        i.description,
        i.packages
      FROM genrpg.instances i
      LEFT JOIN genrpg.instance_user_roles iur
        ON iur.instance_guid = i.guid
        AND iur.user_guid = $1
      WHERE i.guid = $2
        AND ($3::boolean OR iur.user_guid IS NOT NULL)
    `,
    [user.guid, instanceGuid, isAdmin],
  );

  return result.rows[0] || null;
}

async function getUserInstanceRole(instanceGuid, userGuid) {
  const result = await pool.query(
    `
      SELECT r.name AS role_name
      FROM genrpg.instance_user_roles iur
      JOIN genrpg.roles r ON r.id = iur.role_id
      WHERE iur.instance_guid = $1 AND iur.user_guid = $2
    `,
    [instanceGuid, userGuid],
  );
  return result.rows[0]?.role_name || null;
}

async function getUserInstancePermissions(instanceGuid, userGuid) {
  const result = await pool.query(
    `
      SELECT DISTINCT p.name
      FROM genrpg.instance_user_roles iur
      JOIN genrpg.role_permissions rp ON rp.role_id = iur.role_id
      JOIN genrpg.permissions p ON p.id = rp.permission_id
      WHERE iur.instance_guid = $1 AND iur.user_guid = $2
    `,
    [instanceGuid, userGuid],
  );
  return new Set(result.rows.map((r) => r.name));
}

async function canUserManageInstance(instanceGuid, user, requiredPermission) {
  if (await isGlobalAdmin(user.guid)) return true;
  const permissions = await getUserInstancePermissions(instanceGuid, user.guid);
  return permissions.has(requiredPermission);
}

// Resolves instance package assets from the in-memory package cache (no per-request YAML I/O).
instancesRouter.get("/instances/:guid/assets", async (req, res, next) => {
  try {
    const instanceGuid = req.params.guid;
    const user = req.session.user;

    const instance = await loadAccessibleInstance(instanceGuid, user);
    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    // Must have the run permission to load game assets
    const canRun = await canUserManageInstance(instanceGuid, user, "instance.run");
    if (!canRun) {
      res.status(403).json({ error: "You do not have permission to run this instance" });
      return;
    }

    const packageNames = parsePackageCsv(instance.packages);
    const { packages } = await loadPackages({ strict: true });
    const assets = await resolveInstanceAssetsForRequest(packageNames, packages);

    res.json({
      css: assets.css,
      js: assets.js,
      packageNames: assets.packageNames,
      packages: assets.packages,
    });
  } catch (error) {
    if (error instanceof PackageLoadError) {
      res.status(error.status).json({ error: error.message, details: error.details });
      return;
    }

    next(error);
  }
});

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

instancesRouter.post("/instances", async (req, res, next) => {
  try {
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

    const { packages } = await loadPackages({ strict: true });
    const packageSelection = validatePackageSelection(selectedPackages, packages);
    if (!packageSelection.valid) {
      res.status(400).json({ error: "Invalid package selection", details: packageSelection.details });
      return;
    }

    const instanceGuid = crypto.randomUUID();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const instance = await client.query(
        `
          INSERT INTO genrpg.instances (guid, name, description, packages)
          VALUES ($1, $2, $3, $4)
          RETURNING guid, name, description, packages, create_datetime, update_datetime
        `,
        [instanceGuid, name, description, packageSelection.packageCsv],
      );

      // Assign Instance_Owner role to the creator
      const ownerRole = await client.query(
        `SELECT id FROM genrpg.roles WHERE name = 'Instance_Owner'`,
      );
      if (ownerRole.rows.length > 0) {
        await client.query(
          `
            INSERT INTO genrpg.instance_user_roles (instance_guid, user_guid, role_id)
            VALUES ($1, $2, $3)
          `,
          [instanceGuid, req.session.user.guid, ownerRole.rows[0].id],
        );
      }

      await createDefaultInstanceAlias(client, instanceGuid);
      if (urlSegment) {
        await createCustomInstanceAlias(client, instanceGuid, urlSegment);
      }

      await client.query("COMMIT");
      res.status(201).json({
        instance: {
          ...instance.rows[0],
          packageNames: parsePackageCsv(instance.rows[0].packages),
          role: await isGlobalAdmin(req.session.user.guid) ? "Admin" : "Instance_Owner",
          can_manage_users: true,
          can_delete: true,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof PackageLoadError) {
      res.status(error.status).json({ error: error.message, details: error.details });
      return;
    }

    next(error);
  }
});

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

    const canEdit = await canUserManageInstance(instanceGuid, user, "instance.edit");
    if (!canEdit) {
      res.status(403).json({ error: "You do not have permission to edit this instance" });
      return;
    }

    const instance = await loadAccessibleInstance(instanceGuid, user);
    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    const currentUrlSegment = await lookupCustomInstanceUrlSegment(instanceGuid);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const updated = await client.query(
        `
          UPDATE genrpg.instances
          SET name = $2, description = $3
          WHERE guid = $1
          RETURNING guid, name, description, packages, create_datetime, update_datetime
        `,
        [instanceGuid, name, description],
      );

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
    const instance = await loadAccessibleInstance(instanceGuid, user);
    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    const result = await pool.query(
      `
        SELECT
          u.guid,
          u.email,
          u.display_name,
          r.id AS role_id,
          r.name AS role_name
        FROM genrpg.instance_user_roles iur
        JOIN genrpg.users u ON u.guid = iur.user_guid
        JOIN genrpg.roles r ON r.id = iur.role_id
        WHERE iur.instance_guid = $1
        ORDER BY r.id, u.display_name
      `,
      [instanceGuid],
    );

    res.json({
      users: result.rows.map((row) => ({
        guid: row.guid,
        email: row.email,
        displayName: row.display_name,
        roleId: row.role_id,
        roleName: row.role_name,
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
    const canManage = await canUserManageInstance(instanceGuid, user, "instance.manage_users");
    if (!canManage) {
      res.status(403).json({ error: "You do not have permission to manage users on this instance" });
      return;
    }

    // Verify the role exists
    const roleResult = await pool.query(
      `SELECT id, name FROM genrpg.roles WHERE id = $1`,
      [roleId],
    );
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

    await pool.query(
      `
        INSERT INTO genrpg.instance_user_roles (instance_guid, user_guid, role_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (instance_guid, user_guid)
        DO UPDATE SET role_id = EXCLUDED.role_id
      `,
      [instanceGuid, targetUserGuid, roleId],
    );

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
    const canManage = await canUserManageInstance(instanceGuid, user, "instance.manage_users");
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

    await pool.query(
      `DELETE FROM genrpg.instance_user_roles WHERE instance_guid = $1 AND user_guid = $2`,
      [instanceGuid, targetUserGuid],
    );

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
    const canDelete = await canUserManageInstance(instanceGuid, user, "instance.delete");
    if (!canDelete) {
      res.status(403).json({ error: "You do not have permission to delete this instance" });
      return;
    }

    // Verify the instance exists and get name for confirmation
    const instance = await loadAccessibleInstance(instanceGuid, user);
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
      await client.query(`DELETE FROM genrpg.instances WHERE guid = $1`, [instanceGuid]);
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
