const crypto = require("node:crypto");
const express = require("express");
const { pool } = require("../db/pool");
const { isGlobalAdmin } = require("../auth");

const itemTemplatesRouter = express.Router();

async function loadAccessibleInstance(instanceGuid, user) {
  const isAdmin = await isGlobalAdmin(user.guid);
  const result = await pool.query(
    `
      SELECT i.guid
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

async function requireInstancePermission(req, res, instanceGuid, permissionName) {
  const user = req.session.user;
  const instance = await loadAccessibleInstance(instanceGuid, user);
  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return null;
  }

  if (await isGlobalAdmin(user.guid)) {
    return instance;
  }

  const permissions = await getUserInstancePermissions(instanceGuid, user.guid);
  if (!permissions.has(permissionName)) {
    res.status(403).json({ error: "You do not have permission to perform this action" });
    return null;
  }

  return instance;
}

function parseName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseDescription(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "string" ? value : null;
}

function parseWeight(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const weight = Number(value);
  if (!Number.isFinite(weight)) {
    return { error: "Weight must be a number" };
  }
  return { weight };
}

function mapItemTemplateRow(row) {
  return {
    guid: row.guid,
    instance_guid: row.instance_guid,
    name: row.name,
    description: row.description,
    weight: row.weight,
    create_datetime: row.create_datetime,
    update_datetime: row.update_datetime,
  };
}

itemTemplatesRouter.get("/instances/:instanceGuid/item-templates", async (req, res, next) => {
  try {
    const { instanceGuid } = req.params;
    const instance = await requireInstancePermission(req, res, instanceGuid, "instance.run");
    if (!instance) {
      return;
    }

    const result = await pool.query(
      `
        SELECT
          guid,
          instance_guid,
          name,
          description,
          weight,
          create_datetime,
          update_datetime
        FROM genrpg.item_templates
        WHERE instance_guid = $1
        ORDER BY name ASC, create_datetime ASC
      `,
      [instanceGuid],
    );

    res.json({ itemTemplates: result.rows.map(mapItemTemplateRow) });
  } catch (error) {
    next(error);
  }
});

itemTemplatesRouter.get(
  "/instances/:instanceGuid/item-templates/:templateGuid",
  async (req, res, next) => {
    try {
      const { instanceGuid, templateGuid } = req.params;
      const instance = await requireInstancePermission(req, res, instanceGuid, "instance.run");
      if (!instance) {
        return;
      }

      const result = await pool.query(
        `
          SELECT
            guid,
            instance_guid,
            name,
            description,
            weight,
            create_datetime,
            update_datetime
          FROM genrpg.item_templates
          WHERE guid = $1 AND instance_guid = $2
        `,
        [templateGuid, instanceGuid],
      );

      if (!result.rows.length) {
        res.status(404).json({ error: "Item template not found" });
        return;
      }

      res.json({ itemTemplate: mapItemTemplateRow(result.rows[0]) });
    } catch (error) {
      next(error);
    }
  },
);

itemTemplatesRouter.post("/instances/:instanceGuid/item-templates", async (req, res, next) => {
  try {
    const { instanceGuid } = req.params;
    const instance = await requireInstancePermission(req, res, instanceGuid, "instance.edit");
    if (!instance) {
      return;
    }

    const name = parseName(req.body.name);
    const description = parseDescription(req.body.description);
    const weightResult = parseWeight(req.body.weight);

    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    if (weightResult?.error) {
      res.status(400).json({ error: weightResult.error });
      return;
    }

    const templateGuid = crypto.randomUUID();
    const result = await pool.query(
      `
        INSERT INTO genrpg.item_templates (guid, instance_guid, name, description, weight)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          guid,
          instance_guid,
          name,
          description,
          weight,
          create_datetime,
          update_datetime
      `,
      [templateGuid, instanceGuid, name, description, weightResult.weight],
    );

    res.status(201).json({ itemTemplate: mapItemTemplateRow(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

itemTemplatesRouter.put(
  "/instances/:instanceGuid/item-templates/:templateGuid",
  async (req, res, next) => {
    try {
      const { instanceGuid, templateGuid } = req.params;
      const instance = await requireInstancePermission(req, res, instanceGuid, "instance.edit");
      if (!instance) {
        return;
      }

      const name = parseName(req.body.name);
      const description = parseDescription(req.body.description);
      const weightResult = parseWeight(req.body.weight);

      if (!name) {
        res.status(400).json({ error: "Name is required" });
        return;
      }
      if (weightResult?.error) {
        res.status(400).json({ error: weightResult.error });
        return;
      }

      const result = await pool.query(
        `
          UPDATE genrpg.item_templates
          SET name = $1, description = $2, weight = $3
          WHERE guid = $4 AND instance_guid = $5
          RETURNING
            guid,
            instance_guid,
            name,
            description,
            weight,
            create_datetime,
            update_datetime
        `,
        [name, description, weightResult.weight, templateGuid, instanceGuid],
      );

      if (!result.rows.length) {
        res.status(404).json({ error: "Item template not found" });
        return;
      }

      res.json({ itemTemplate: mapItemTemplateRow(result.rows[0]) });
    } catch (error) {
      next(error);
    }
  },
);

itemTemplatesRouter.delete(
  "/instances/:instanceGuid/item-templates/:templateGuid",
  async (req, res, next) => {
    try {
      const { instanceGuid, templateGuid } = req.params;
      const instance = await requireInstancePermission(req, res, instanceGuid, "instance.edit");
      if (!instance) {
        return;
      }

      const result = await pool.query(
        `
          DELETE FROM genrpg.item_templates
          WHERE guid = $1 AND instance_guid = $2
          RETURNING guid
        `,
        [templateGuid, instanceGuid],
      );

      if (!result.rows.length) {
        res.status(404).json({ error: "Item template not found" });
        return;
      }

      res.status(204).send();
    } catch (error) {
      if (error.code === "23503") {
        res.status(409).json({
          error: "Cannot delete this template while items still reference it",
        });
        return;
      }
      next(error);
    }
  },
);

module.exports = itemTemplatesRouter;
