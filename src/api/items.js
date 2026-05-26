const crypto = require("node:crypto");
const express = require("express");
const { pool } = require("../db/pool");
const { isGlobalAdmin } = require("../auth");

const itemsRouter = express.Router();

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

function parseOptionalName(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return { error: "Name must be a string" };
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseOptionalDescription(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return { error: "Description must be a string" };
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseOptionalWeight(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const weight = Number(value);
  if (!Number.isFinite(weight)) {
    return { error: "Weight must be a number" };
  }
  return { weight };
}

function parseItemTemplateGuid(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

function mapItemTemplateSummary(row) {
  return {
    guid: row.template_guid,
    name: row.template_name,
    description: row.template_description,
    weight: row.template_weight,
  };
}

function mapItemRow(row) {
  const itemTemplate = mapItemTemplateSummary(row);
  const effectiveName = row.name ?? row.template_name;
  const effectiveDescription = row.description ?? row.template_description;
  const effectiveWeight =
    row.weight !== null && row.weight !== undefined ? row.weight : row.template_weight;

  return {
    guid: row.guid,
    instance_guid: row.instance_guid,
    item_template_guid: row.item_template_guid,
    name: row.name,
    description: row.description,
    weight: row.weight,
    create_datetime: row.create_datetime,
    update_datetime: row.update_datetime,
    itemTemplate,
    effectiveName,
    effectiveDescription,
    effectiveWeight,
  };
}

const ITEM_SELECT = `
  SELECT
    i.guid,
    i.instance_guid,
    i.item_template_guid,
    i.name,
    i.description,
    i.weight,
    i.create_datetime,
    i.update_datetime,
    t.guid AS template_guid,
    t.name AS template_name,
    t.description AS template_description,
    t.weight AS template_weight
  FROM genrpg.items i
  JOIN genrpg.item_templates t ON t.guid = i.item_template_guid
`;

async function loadItemForInstance(instanceGuid, itemGuid) {
  const result = await pool.query(
    `
      ${ITEM_SELECT}
      WHERE i.guid = $1 AND i.instance_guid = $2
    `,
    [itemGuid, instanceGuid],
  );
  return result.rows[0] || null;
}

async function loadTemplateForInstance(instanceGuid, templateGuid) {
  const result = await pool.query(
    `
      SELECT guid
      FROM genrpg.item_templates
      WHERE guid = $1 AND instance_guid = $2
    `,
    [templateGuid, instanceGuid],
  );
  return result.rows[0] || null;
}

itemsRouter.get("/instances/:instanceGuid/items", async (req, res, next) => {
  try {
    const { instanceGuid } = req.params;
    const instance = await requireInstancePermission(req, res, instanceGuid, "instance.run");
    if (!instance) {
      return;
    }

    const result = await pool.query(
      `
        ${ITEM_SELECT}
        WHERE i.instance_guid = $1
        ORDER BY COALESCE(i.name, t.name) ASC, i.create_datetime ASC
      `,
      [instanceGuid],
    );

    res.json({ items: result.rows.map(mapItemRow) });
  } catch (error) {
    next(error);
  }
});

itemsRouter.get("/instances/:instanceGuid/items/:itemGuid", async (req, res, next) => {
  try {
    const { instanceGuid, itemGuid } = req.params;
    const instance = await requireInstancePermission(req, res, instanceGuid, "instance.run");
    if (!instance) {
      return;
    }

    const row = await loadItemForInstance(instanceGuid, itemGuid);
    if (!row) {
      res.status(404).json({ error: "Item not found" });
      return;
    }

    res.json({ item: mapItemRow(row) });
  } catch (error) {
    next(error);
  }
});

itemsRouter.post("/instances/:instanceGuid/items", async (req, res, next) => {
  try {
    const { instanceGuid } = req.params;
    const instance = await requireInstancePermission(req, res, instanceGuid, "instance.edit");
    if (!instance) {
      return;
    }

    const itemTemplateGuid = parseItemTemplateGuid(
      req.body.itemTemplateGuid ?? req.body.item_template_guid,
    );
    if (!itemTemplateGuid) {
      res.status(400).json({ error: "Item template is required" });
      return;
    }

    const template = await loadTemplateForInstance(instanceGuid, itemTemplateGuid);
    if (!template) {
      res.status(400).json({ error: "Item template not found for this instance" });
      return;
    }

    const nameResult = parseOptionalName(req.body.name);
    if (nameResult?.error) {
      res.status(400).json({ error: nameResult.error });
      return;
    }

    const descriptionResult = parseOptionalDescription(req.body.description);
    if (descriptionResult?.error) {
      res.status(400).json({ error: descriptionResult.error });
      return;
    }

    const weightResult = parseOptionalWeight(req.body.weight);
    if (weightResult?.error) {
      res.status(400).json({ error: weightResult.error });
      return;
    }

    const itemGuid = crypto.randomUUID();
    const result = await pool.query(
      `
        INSERT INTO genrpg.items (
          guid,
          instance_guid,
          item_template_guid,
          name,
          description,
          weight
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING guid
      `,
      [
        itemGuid,
        instanceGuid,
        itemTemplateGuid,
        nameResult,
        descriptionResult,
        weightResult?.weight ?? null,
      ],
    );

    const row = await loadItemForInstance(instanceGuid, result.rows[0].guid);
    res.status(201).json({ item: mapItemRow(row) });
  } catch (error) {
    next(error);
  }
});

itemsRouter.put("/instances/:instanceGuid/items/:itemGuid", async (req, res, next) => {
  try {
    const { instanceGuid, itemGuid } = req.params;
    const instance = await requireInstancePermission(req, res, instanceGuid, "instance.edit");
    if (!instance) {
      return;
    }

    const itemTemplateGuid = parseItemTemplateGuid(
      req.body.itemTemplateGuid ?? req.body.item_template_guid,
    );
    if (!itemTemplateGuid) {
      res.status(400).json({ error: "Item template is required" });
      return;
    }

    const template = await loadTemplateForInstance(instanceGuid, itemTemplateGuid);
    if (!template) {
      res.status(400).json({ error: "Item template not found for this instance" });
      return;
    }

    const nameResult = parseOptionalName(req.body.name);
    if (nameResult?.error) {
      res.status(400).json({ error: nameResult.error });
      return;
    }

    const descriptionResult = parseOptionalDescription(req.body.description);
    if (descriptionResult?.error) {
      res.status(400).json({ error: descriptionResult.error });
      return;
    }

    const weightResult = parseOptionalWeight(req.body.weight);
    if (weightResult?.error) {
      res.status(400).json({ error: weightResult.error });
      return;
    }

    const updateResult = await pool.query(
      `
        UPDATE genrpg.items
        SET
          item_template_guid = $1,
          name = $2,
          description = $3,
          weight = $4
        WHERE guid = $5 AND instance_guid = $6
        RETURNING guid
      `,
      [
        itemTemplateGuid,
        nameResult,
        descriptionResult,
        weightResult?.weight ?? null,
        itemGuid,
        instanceGuid,
      ],
    );

    if (!updateResult.rows.length) {
      res.status(404).json({ error: "Item not found" });
      return;
    }

    const row = await loadItemForInstance(instanceGuid, updateResult.rows[0].guid);
    res.json({ item: mapItemRow(row) });
  } catch (error) {
    next(error);
  }
});

itemsRouter.delete("/instances/:instanceGuid/items/:itemGuid", async (req, res, next) => {
  try {
    const { instanceGuid, itemGuid } = req.params;
    const instance = await requireInstancePermission(req, res, instanceGuid, "instance.edit");
    if (!instance) {
      return;
    }

    const result = await pool.query(
      `
        DELETE FROM genrpg.items
        WHERE guid = $1 AND instance_guid = $2
        RETURNING guid
      `,
      [itemGuid, instanceGuid],
    );

    if (!result.rows.length) {
      res.status(404).json({ error: "Item not found" });
      return;
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

module.exports = itemsRouter;
