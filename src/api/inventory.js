const crypto = require("node:crypto");
const express = require("express");
const { pool } = require("../db/pool");
const { isGlobalAdmin } = require("../auth");

const inventoryRouter = express.Router();

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
  return new Set(result.rows.map((row) => row.name));
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

function bodyField(body, camelKey, snakeKey) {
  return body[camelKey] ?? body[snakeKey];
}

function parseRequiredText(value, fieldLabel) {
  if (typeof value !== "string") {
    return { error: `${fieldLabel} is required` };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { error: `${fieldLabel} is required` };
  }
  return trimmed;
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

function parseOptionalUuid(value, fieldLabel) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return { error: `${fieldLabel} must be a string` };
  }
  return value.trim();
}

function parseOptionalCapacity(value, fieldLabel) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { error: `${fieldLabel} must be a number` };
  }
  return parsed;
}

function parseInteger(value, fieldLabel, { min } = {}) {
  if (value === null || value === undefined || value === "") {
    return { error: `${fieldLabel} is required` };
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return { error: `${fieldLabel} must be an integer` };
  }
  if (min !== undefined && parsed < min) {
    return { error: `${fieldLabel} must be at least ${min}` };
  }
  return parsed;
}

function parseContentTarget(body, { required } = {}) {
  const itemGuid = parseOptionalUuid(
    bodyField(body, "itemGuid", "item_guid"),
    "Item",
  );
  if (itemGuid?.error) {
    return itemGuid;
  }

  const subcollectionGuid = parseOptionalUuid(
    bodyField(body, "subcollectionGuid", "subcollection_guid"),
    "Subcollection",
  );
  if (subcollectionGuid?.error) {
    return subcollectionGuid;
  }

  const hasItem = itemGuid !== null;
  const hasSubcollection = subcollectionGuid !== null;

  if (required && !hasItem && !hasSubcollection) {
    return { error: "Either item or subcollection is required" };
  }

  if (hasItem && hasSubcollection) {
    return { error: "Specify either item or subcollection, not both" };
  }

  if (!required && !hasItem && !hasSubcollection) {
    return { itemGuid: null, subcollectionGuid: null };
  }

  return { itemGuid, subcollectionGuid };
}

function mapCollectionRow(row) {
  return {
    guid: row.guid,
    instance_guid: row.instance_guid,
    type: row.type,
    name: row.name,
    item_guid: row.item_guid,
    capacity_used: row.capacity_used,
    capacity_max: row.capacity_max,
    create_datetime: row.create_datetime,
    update_datetime: row.update_datetime,
  };
}

function mapContentRow(row) {
  return {
    guid: row.guid,
    instance_guid: row.instance_guid,
    collection_guid: row.collection_guid,
    item_guid: row.item_guid,
    subcollection_guid: row.subcollection_guid,
    quantity: row.quantity,
    position: row.position,
    create_datetime: row.create_datetime,
    update_datetime: row.update_datetime,
  };
}

function mapInventoryRow(row) {
  return {
    guid: row.guid,
    instance_guid: row.instance_guid,
    collection_guid: row.collection_guid,
    character_guid: row.character_guid,
    create_datetime: row.create_datetime,
    update_datetime: row.update_datetime,
  };
}

async function loadCollectionForInstance(instanceGuid, collectionGuid) {
  const result = await pool.query(
    `
      SELECT
        guid,
        instance_guid,
        type,
        name,
        item_guid,
        capacity_used,
        capacity_max,
        create_datetime,
        update_datetime
      FROM genrpg.item_collections
      WHERE guid = $1 AND instance_guid = $2
    `,
    [collectionGuid, instanceGuid],
  );
  return result.rows[0] || null;
}

async function loadItemForInstance(instanceGuid, itemGuid) {
  const result = await pool.query(
    `
      SELECT guid
      FROM genrpg.items
      WHERE guid = $1 AND instance_guid = $2
    `,
    [itemGuid, instanceGuid],
  );
  return result.rows[0] || null;
}

async function loadCharacterForInstance(instanceGuid, characterGuid) {
  const result = await pool.query(
    `
      SELECT guid
      FROM genrpg.characters
      WHERE guid = $1 AND instance_guid = $2
    `,
    [characterGuid, instanceGuid],
  );
  return result.rows[0] || null;
}

async function loadContentForCollection(instanceGuid, collectionGuid, contentGuid) {
  const result = await pool.query(
    `
      SELECT
        guid,
        instance_guid,
        collection_guid,
        item_guid,
        subcollection_guid,
        quantity,
        position,
        create_datetime,
        update_datetime
      FROM genrpg.item_collection_contents
      WHERE guid = $1
        AND collection_guid = $2
        AND instance_guid = $3
    `,
    [contentGuid, collectionGuid, instanceGuid],
  );
  return result.rows[0] || null;
}

async function loadInventoryForInstance(instanceGuid, inventoryGuid) {
  const result = await pool.query(
    `
      SELECT
        guid,
        instance_guid,
        collection_guid,
        character_guid,
        create_datetime,
        update_datetime
      FROM genrpg.inventories
      WHERE guid = $1 AND instance_guid = $2
    `,
    [inventoryGuid, instanceGuid],
  );
  return result.rows[0] || null;
}

// --- item collections ---

inventoryRouter.get("/instances/:instanceGuid/item-collections", async (req, res, next) => {
  try {
    const { instanceGuid } = req.params;
    const instance = await requireInstancePermission(req, res, instanceGuid, "instance.run");
    if (!instance) {
      return;
    }

    const itemGuid = parseOptionalUuid(req.query.itemGuid ?? req.query.item_guid, "Item");
    if (itemGuid?.error) {
      res.status(400).json({ error: itemGuid.error });
      return;
    }

    const typeFilter =
      typeof req.query.type === "string" && req.query.type.trim() !== ""
        ? req.query.type.trim()
        : null;

    const params = [instanceGuid];
    const conditions = ["instance_guid = $1"];

    if (itemGuid) {
      params.push(itemGuid);
      conditions.push(`item_guid = $${params.length}`);
    }

    if (typeFilter) {
      params.push(typeFilter);
      conditions.push(`type = $${params.length}`);
    }

    const result = await pool.query(
      `
        SELECT
          guid,
          instance_guid,
          type,
          name,
          item_guid,
          capacity_used,
          capacity_max,
          create_datetime,
          update_datetime
        FROM genrpg.item_collections
        WHERE ${conditions.join(" AND ")}
        ORDER BY type ASC, COALESCE(name, '') ASC, create_datetime ASC
      `,
      params,
    );

    res.json({ itemCollections: result.rows.map(mapCollectionRow) });
  } catch (error) {
    next(error);
  }
});

inventoryRouter.get(
  "/instances/:instanceGuid/item-collections/:collectionGuid",
  async (req, res, next) => {
    try {
      const { instanceGuid, collectionGuid } = req.params;
      const instance = await requireInstancePermission(req, res, instanceGuid, "instance.run");
      if (!instance) {
        return;
      }

      const row = await loadCollectionForInstance(instanceGuid, collectionGuid);
      if (!row) {
        res.status(404).json({ error: "Item collection not found" });
        return;
      }

      res.json({ itemCollection: mapCollectionRow(row) });
    } catch (error) {
      next(error);
    }
  },
);

inventoryRouter.post("/instances/:instanceGuid/item-collections", async (req, res, next) => {
  try {
    const { instanceGuid } = req.params;
    const instance = await requireInstancePermission(req, res, instanceGuid, "instance.edit");
    if (!instance) {
      return;
    }

    const type = parseRequiredText(bodyField(req.body, "type", "type"), "Type");
    if (type.error) {
      res.status(400).json({ error: type.error });
      return;
    }

    const nameResult = parseOptionalName(req.body.name);
    if (nameResult?.error) {
      res.status(400).json({ error: nameResult.error });
      return;
    }

    const itemGuid = parseOptionalUuid(
      bodyField(req.body, "itemGuid", "item_guid"),
      "Item",
    );
    if (itemGuid?.error) {
      res.status(400).json({ error: itemGuid.error });
      return;
    }

    if (itemGuid) {
      const item = await loadItemForInstance(instanceGuid, itemGuid);
      if (!item) {
        res.status(400).json({ error: "Item not found for this instance" });
        return;
      }
    }

    const capacityUsed = parseOptionalCapacity(
      bodyField(req.body, "capacityUsed", "capacity_used"),
      "Capacity used",
    );
    if (capacityUsed?.error) {
      res.status(400).json({ error: capacityUsed.error });
      return;
    }

    const capacityMax = parseOptionalCapacity(
      bodyField(req.body, "capacityMax", "capacity_max"),
      "Capacity max",
    );
    if (capacityMax?.error) {
      res.status(400).json({ error: capacityMax.error });
      return;
    }

    const collectionGuid = crypto.randomUUID();
    await pool.query(
      `
        INSERT INTO genrpg.item_collections (
          guid,
          instance_guid,
          type,
          name,
          item_guid,
          capacity_used,
          capacity_max
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        collectionGuid,
        instanceGuid,
        type,
        nameResult,
        itemGuid,
        capacityUsed,
        capacityMax,
      ],
    );

    const row = await loadCollectionForInstance(instanceGuid, collectionGuid);
    res.status(201).json({ itemCollection: mapCollectionRow(row) });
  } catch (error) {
    next(error);
  }
});

inventoryRouter.put(
  "/instances/:instanceGuid/item-collections/:collectionGuid",
  async (req, res, next) => {
    try {
      const { instanceGuid, collectionGuid } = req.params;
      const instance = await requireInstancePermission(req, res, instanceGuid, "instance.edit");
      if (!instance) {
        return;
      }

      const type = parseRequiredText(bodyField(req.body, "type", "type"), "Type");
      if (type.error) {
        res.status(400).json({ error: type.error });
        return;
      }

      const nameResult = parseOptionalName(req.body.name);
      if (nameResult?.error) {
        res.status(400).json({ error: nameResult.error });
        return;
      }

      const itemGuid = parseOptionalUuid(
        bodyField(req.body, "itemGuid", "item_guid"),
        "Item",
      );
      if (itemGuid?.error) {
        res.status(400).json({ error: itemGuid.error });
        return;
      }

      if (itemGuid) {
        const item = await loadItemForInstance(instanceGuid, itemGuid);
        if (!item) {
          res.status(400).json({ error: "Item not found for this instance" });
          return;
        }
      }

      const capacityUsed = parseOptionalCapacity(
        bodyField(req.body, "capacityUsed", "capacity_used"),
        "Capacity used",
      );
      if (capacityUsed?.error) {
        res.status(400).json({ error: capacityUsed.error });
        return;
      }

      const capacityMax = parseOptionalCapacity(
        bodyField(req.body, "capacityMax", "capacity_max"),
        "Capacity max",
      );
      if (capacityMax?.error) {
        res.status(400).json({ error: capacityMax.error });
        return;
      }

      const updateResult = await pool.query(
        `
          UPDATE genrpg.item_collections
          SET
            type = $1,
            name = $2,
            item_guid = $3,
            capacity_used = $4,
            capacity_max = $5
          WHERE guid = $6 AND instance_guid = $7
          RETURNING guid
        `,
        [type, nameResult, itemGuid, capacityUsed, capacityMax, collectionGuid, instanceGuid],
      );

      if (!updateResult.rows.length) {
        res.status(404).json({ error: "Item collection not found" });
        return;
      }

      const row = await loadCollectionForInstance(instanceGuid, collectionGuid);
      res.json({ itemCollection: mapCollectionRow(row) });
    } catch (error) {
      next(error);
    }
  },
);

inventoryRouter.delete(
  "/instances/:instanceGuid/item-collections/:collectionGuid",
  async (req, res, next) => {
    try {
      const { instanceGuid, collectionGuid } = req.params;
      const instance = await requireInstancePermission(req, res, instanceGuid, "instance.edit");
      if (!instance) {
        return;
      }

      const result = await pool.query(
        `
          DELETE FROM genrpg.item_collections
          WHERE guid = $1 AND instance_guid = $2
          RETURNING guid
        `,
        [collectionGuid, instanceGuid],
      );

      if (!result.rows.length) {
        res.status(404).json({ error: "Item collection not found" });
        return;
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

// --- item collection contents ---

inventoryRouter.get(
  "/instances/:instanceGuid/item-collections/:collectionGuid/contents",
  async (req, res, next) => {
    try {
      const { instanceGuid, collectionGuid } = req.params;
      const instance = await requireInstancePermission(req, res, instanceGuid, "instance.run");
      if (!instance) {
        return;
      }

      const collection = await loadCollectionForInstance(instanceGuid, collectionGuid);
      if (!collection) {
        res.status(404).json({ error: "Item collection not found" });
        return;
      }

      const result = await pool.query(
        `
          SELECT
            guid,
            instance_guid,
            collection_guid,
            item_guid,
            subcollection_guid,
            quantity,
            position,
            create_datetime,
            update_datetime
          FROM genrpg.item_collection_contents
          WHERE collection_guid = $1 AND instance_guid = $2
          ORDER BY position ASC, create_datetime ASC
        `,
        [collectionGuid, instanceGuid],
      );

      res.json({ contents: result.rows.map(mapContentRow) });
    } catch (error) {
      next(error);
    }
  },
);

inventoryRouter.get(
  "/instances/:instanceGuid/item-collections/:collectionGuid/contents/:contentGuid",
  async (req, res, next) => {
    try {
      const { instanceGuid, collectionGuid, contentGuid } = req.params;
      const instance = await requireInstancePermission(req, res, instanceGuid, "instance.run");
      if (!instance) {
        return;
      }

      const row = await loadContentForCollection(instanceGuid, collectionGuid, contentGuid);
      if (!row) {
        res.status(404).json({ error: "Collection content not found" });
        return;
      }

      res.json({ content: mapContentRow(row) });
    } catch (error) {
      next(error);
    }
  },
);

inventoryRouter.post(
  "/instances/:instanceGuid/item-collections/:collectionGuid/contents",
  async (req, res, next) => {
    try {
      const { instanceGuid, collectionGuid } = req.params;
      const instance = await requireInstancePermission(req, res, instanceGuid, "instance.edit");
      if (!instance) {
        return;
      }

      const collection = await loadCollectionForInstance(instanceGuid, collectionGuid);
      if (!collection) {
        res.status(404).json({ error: "Item collection not found" });
        return;
      }

      const target = parseContentTarget(req.body, { required: true });
      if (target.error) {
        res.status(400).json({ error: target.error });
        return;
      }

      if (target.itemGuid) {
        const item = await loadItemForInstance(instanceGuid, target.itemGuid);
        if (!item) {
          res.status(400).json({ error: "Item not found for this instance" });
          return;
        }
      } else {
        const subcollection = await loadCollectionForInstance(
          instanceGuid,
          target.subcollectionGuid,
        );
        if (!subcollection) {
          res.status(400).json({ error: "Subcollection not found for this instance" });
          return;
        }
        if (target.subcollectionGuid === collectionGuid) {
          res.status(400).json({ error: "A collection cannot contain itself" });
          return;
        }
      }

      const quantity = parseInteger(
        bodyField(req.body, "quantity", "quantity") ?? 1,
        "Quantity",
        { min: 0 },
      );
      if (quantity.error) {
        res.status(400).json({ error: quantity.error });
        return;
      }

      const position = parseInteger(
        bodyField(req.body, "position", "position") ?? 0,
        "Position",
      );
      if (position.error) {
        res.status(400).json({ error: position.error });
        return;
      }

      const contentGuid = crypto.randomUUID();
      await pool.query(
        `
          INSERT INTO genrpg.item_collection_contents (
            guid,
            instance_guid,
            collection_guid,
            item_guid,
            subcollection_guid,
            quantity,
            position
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          contentGuid,
          instanceGuid,
          collectionGuid,
          target.itemGuid,
          target.subcollectionGuid,
          quantity,
          position,
        ],
      );

      const row = await loadContentForCollection(instanceGuid, collectionGuid, contentGuid);
      res.status(201).json({ content: mapContentRow(row) });
    } catch (error) {
      next(error);
    }
  },
);

inventoryRouter.put(
  "/instances/:instanceGuid/item-collections/:collectionGuid/contents/:contentGuid",
  async (req, res, next) => {
    try {
      const { instanceGuid, collectionGuid, contentGuid } = req.params;
      const instance = await requireInstancePermission(req, res, instanceGuid, "instance.edit");
      if (!instance) {
        return;
      }

      const existing = await loadContentForCollection(instanceGuid, collectionGuid, contentGuid);
      if (!existing) {
        res.status(404).json({ error: "Collection content not found" });
        return;
      }

      const target = parseContentTarget(req.body, { required: true });
      if (target.error) {
        res.status(400).json({ error: target.error });
        return;
      }

      if (target.itemGuid) {
        const item = await loadItemForInstance(instanceGuid, target.itemGuid);
        if (!item) {
          res.status(400).json({ error: "Item not found for this instance" });
          return;
        }
      } else {
        const subcollection = await loadCollectionForInstance(
          instanceGuid,
          target.subcollectionGuid,
        );
        if (!subcollection) {
          res.status(400).json({ error: "Subcollection not found for this instance" });
          return;
        }
        if (target.subcollectionGuid === collectionGuid) {
          res.status(400).json({ error: "A collection cannot contain itself" });
          return;
        }
      }

      const quantity = parseInteger(bodyField(req.body, "quantity", "quantity"), "Quantity", {
        min: 0,
      });
      if (quantity.error) {
        res.status(400).json({ error: quantity.error });
        return;
      }

      const position = parseInteger(bodyField(req.body, "position", "position"), "Position");
      if (position.error) {
        res.status(400).json({ error: position.error });
        return;
      }

      await pool.query(
        `
          UPDATE genrpg.item_collection_contents
          SET
            item_guid = $1,
            subcollection_guid = $2,
            quantity = $3,
            position = $4
          WHERE guid = $5
            AND collection_guid = $6
            AND instance_guid = $7
        `,
        [
          target.itemGuid,
          target.subcollectionGuid,
          quantity,
          position,
          contentGuid,
          collectionGuid,
          instanceGuid,
        ],
      );

      const row = await loadContentForCollection(instanceGuid, collectionGuid, contentGuid);
      res.json({ content: mapContentRow(row) });
    } catch (error) {
      next(error);
    }
  },
);

inventoryRouter.delete(
  "/instances/:instanceGuid/item-collections/:collectionGuid/contents/:contentGuid",
  async (req, res, next) => {
    try {
      const { instanceGuid, collectionGuid, contentGuid } = req.params;
      const instance = await requireInstancePermission(req, res, instanceGuid, "instance.edit");
      if (!instance) {
        return;
      }

      const result = await pool.query(
        `
          DELETE FROM genrpg.item_collection_contents
          WHERE guid = $1
            AND collection_guid = $2
            AND instance_guid = $3
          RETURNING guid
        `,
        [contentGuid, collectionGuid, instanceGuid],
      );

      if (!result.rows.length) {
        res.status(404).json({ error: "Collection content not found" });
        return;
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

// --- inventories ---

inventoryRouter.get("/instances/:instanceGuid/inventories", async (req, res, next) => {
  try {
    const { instanceGuid } = req.params;
    const instance = await requireInstancePermission(req, res, instanceGuid, "instance.run");
    if (!instance) {
      return;
    }

    const characterGuid = parseOptionalUuid(
      req.query.characterGuid ?? req.query.character_guid,
      "Character",
    );
    if (characterGuid?.error) {
      res.status(400).json({ error: characterGuid.error });
      return;
    }

    const collectionGuid = parseOptionalUuid(
      req.query.collectionGuid ?? req.query.collection_guid,
      "Collection",
    );
    if (collectionGuid?.error) {
      res.status(400).json({ error: collectionGuid.error });
      return;
    }

    const params = [instanceGuid];
    const conditions = ["instance_guid = $1"];

    if (characterGuid) {
      params.push(characterGuid);
      conditions.push(`character_guid = $${params.length}`);
    }

    if (collectionGuid) {
      params.push(collectionGuid);
      conditions.push(`collection_guid = $${params.length}`);
    }

    const result = await pool.query(
      `
        SELECT
          guid,
          instance_guid,
          collection_guid,
          character_guid,
          create_datetime,
          update_datetime
        FROM genrpg.inventories
        WHERE ${conditions.join(" AND ")}
        ORDER BY create_datetime ASC
      `,
      params,
    );

    res.json({ inventories: result.rows.map(mapInventoryRow) });
  } catch (error) {
    next(error);
  }
});

inventoryRouter.get("/instances/:instanceGuid/inventories/:inventoryGuid", async (req, res, next) => {
  try {
    const { instanceGuid, inventoryGuid } = req.params;
    const instance = await requireInstancePermission(req, res, instanceGuid, "instance.run");
    if (!instance) {
      return;
    }

    const row = await loadInventoryForInstance(instanceGuid, inventoryGuid);
    if (!row) {
      res.status(404).json({ error: "Inventory not found" });
      return;
    }

    res.json({ inventory: mapInventoryRow(row) });
  } catch (error) {
    next(error);
  }
});

inventoryRouter.post("/instances/:instanceGuid/inventories", async (req, res, next) => {
  try {
    const { instanceGuid } = req.params;
    const instance = await requireInstancePermission(req, res, instanceGuid, "instance.edit");
    if (!instance) {
      return;
    }

    const collectionGuid = parseOptionalUuid(
      bodyField(req.body, "collectionGuid", "collection_guid"),
      "Collection",
    );
    if (!collectionGuid || collectionGuid.error) {
      res.status(400).json({
        error: collectionGuid?.error || "Collection is required",
      });
      return;
    }

    const characterGuid = parseOptionalUuid(
      bodyField(req.body, "characterGuid", "character_guid"),
      "Character",
    );
    if (!characterGuid || characterGuid.error) {
      res.status(400).json({
        error: characterGuid?.error || "Character is required",
      });
      return;
    }

    const collection = await loadCollectionForInstance(instanceGuid, collectionGuid);
    if (!collection) {
      res.status(400).json({ error: "Collection not found for this instance" });
      return;
    }

    const character = await loadCharacterForInstance(instanceGuid, characterGuid);
    if (!character) {
      res.status(400).json({ error: "Character not found for this instance" });
      return;
    }

    const inventoryGuid = crypto.randomUUID();
    await pool.query(
      `
        INSERT INTO genrpg.inventories (
          guid,
          instance_guid,
          collection_guid,
          character_guid
        )
        VALUES ($1, $2, $3, $4)
      `,
      [inventoryGuid, instanceGuid, collectionGuid, characterGuid],
    );

    const row = await loadInventoryForInstance(instanceGuid, inventoryGuid);
    res.status(201).json({ inventory: mapInventoryRow(row) });
  } catch (error) {
    next(error);
  }
});

inventoryRouter.put("/instances/:instanceGuid/inventories/:inventoryGuid", async (req, res, next) => {
  try {
    const { instanceGuid, inventoryGuid } = req.params;
    const instance = await requireInstancePermission(req, res, instanceGuid, "instance.edit");
    if (!instance) {
      return;
    }

    const collectionGuid = parseOptionalUuid(
      bodyField(req.body, "collectionGuid", "collection_guid"),
      "Collection",
    );
    if (!collectionGuid || collectionGuid.error) {
      res.status(400).json({
        error: collectionGuid?.error || "Collection is required",
      });
      return;
    }

    const characterGuid = parseOptionalUuid(
      bodyField(req.body, "characterGuid", "character_guid"),
      "Character",
    );
    if (!characterGuid || characterGuid.error) {
      res.status(400).json({
        error: characterGuid?.error || "Character is required",
      });
      return;
    }

    const collection = await loadCollectionForInstance(instanceGuid, collectionGuid);
    if (!collection) {
      res.status(400).json({ error: "Collection not found for this instance" });
      return;
    }

    const character = await loadCharacterForInstance(instanceGuid, characterGuid);
    if (!character) {
      res.status(400).json({ error: "Character not found for this instance" });
      return;
    }

    const updateResult = await pool.query(
      `
        UPDATE genrpg.inventories
        SET collection_guid = $1, character_guid = $2
        WHERE guid = $3 AND instance_guid = $4
        RETURNING guid
      `,
      [collectionGuid, characterGuid, inventoryGuid, instanceGuid],
    );

    if (!updateResult.rows.length) {
      res.status(404).json({ error: "Inventory not found" });
      return;
    }

    const row = await loadInventoryForInstance(instanceGuid, inventoryGuid);
    res.json({ inventory: mapInventoryRow(row) });
  } catch (error) {
    next(error);
  }
});

inventoryRouter.delete(
  "/instances/:instanceGuid/inventories/:inventoryGuid",
  async (req, res, next) => {
    try {
      const { instanceGuid, inventoryGuid } = req.params;
      const instance = await requireInstancePermission(req, res, instanceGuid, "instance.edit");
      if (!instance) {
        return;
      }

      const result = await pool.query(
        `
          DELETE FROM genrpg.inventories
          WHERE guid = $1 AND instance_guid = $2
          RETURNING guid
        `,
        [inventoryGuid, instanceGuid],
      );

      if (!result.rows.length) {
        res.status(404).json({ error: "Inventory not found" });
        return;
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

module.exports = inventoryRouter;
