const { ValidationError } = require("../errors/ValidationError");
const { NotFoundError } = require("../errors/NotFoundError");
const express = require("express");
const { pool } = require("../db/pool");
const { withTransaction, getTransactionClient } = require("../db/transactionContext");
const { selectQuery, qualify } = require("../services/queryService");
const { applyInstallForInstance } = require("../install");
const { isGlobalAdmin } = require("../auth");
const {
  loadAccessibleInstance,
  getUserInstanceRole,
  userHasPermission,
  assignInstanceRole,
} = require("../services/permissionService");
const RoleStorage = require("../storage/roleStorage");
const { asyncRoute } = require("../lib/httpResponse");
const { trimmedString } = require("../lib/strings");
const {
  loadPackages,
  resolveInstanceAssetsForRequest,
  packagesFromMachineNames,
} = require("../packages");
const InstanceStorage = require("../../genrpg/storage/instanceStorage");
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

  const instance = await loadAccessibleInstance(instanceGuid, user);
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

  const packages = await loadPackages({ strict: true });
  const assets = await resolveInstanceAssetsForRequest(instance.packageNames, packages);

  res.json({
    css: assets.css,
    js: assets.js,
    packageNames: assets.packageNames,
    packages: assets.packages,
  });
}));

instancesRouter.get("/instances", asyncRoute(async (req, res) => {
  const user = req.session.user;
  const isAdmin = await isGlobalAdmin(user.guid);
  const instanceStorage = InstanceStorage.global();

  // 1. Instances this user can access (and their role / list UI capabilities).
  let instances;
  const accessByGuid = new Map();

  if (isAdmin) {
    instances = await instanceStorage.list({ skipEvents: true });
    for (const instance of instances) {
      accessByGuid.set(instance.guid, {
        role: "Admin",
        canManageUsers: true,
        canDelete: true,
        canEdit: true,
      });
    }
  } else {
    const iur = "uir";
    const rn = "rn";
    const rp = "rp";
    const pn = "pn";
    const schema = "genrpg";
    const accessQuery = selectQuery()
      .from("genrpg", "user_instance_roles", iur)
      .addFields(iur, "instance_guid")
      .addJoin(schema, "role_name", rn,
        `${qualify(rn, "entity_guid")} = ${qualify(iur, "role_guid")}`,
      )
      .addFields(rn, "value", "role_name")
      .addLeftJoin(schema, "role_permissions", rp,
        `${qualify(rp, "entity_guid")} = ${qualify(iur, "role_guid")}`,
      )
      .addLeftJoin(schema, "permission_name", pn,
        `${qualify(pn, "entity_guid")} = ${qualify(rp, "value")}`,
      )
      .addFields(pn, "value", "permission_name")
      .whereColumn(iur, "entity_guid", user.guid);

    const accessResult = await pool.query(accessQuery.toString(), accessQuery.params);
    for (const row of accessResult.rows) {
      let access = accessByGuid.get(row.instance_guid);
      if (!access) {
        access = {
          role: row.role_name,
          permissions: new Set(),
        };
        accessByGuid.set(row.instance_guid, access);
      }
      if (row.permission_name) {
        access.permissions.add(row.permission_name);
      }
    }

    const guids = [...accessByGuid.keys()];
    instances = guids.length
      ? await instanceStorage.load(guids, { skipEvents: true })
      : [];

    for (const [guid, access] of accessByGuid) {
      accessByGuid.set(guid, {
        role: access.role,
        canManageUsers: access.permissions.has("instance.manage_users"),
        canDelete: access.permissions.has("instance.delete"),
        canEdit: access.permissions.has("instance.edit"),
      });
    }
  }

  // 2. Custom URL segment per instance (shortest non-default alias).
  const urlSegmentByGuid = new Map();
  if (instances.length) {
    const paths = instances.map((instance) => `instance:${instance.guid}`);
    const pathToGuid = new Map(paths.map((path, index) => [path, instances[index].guid]));
    const aliasQuery = selectQuery()
      .from("genrpg", "url_aliases", "ua")
      .addFields("ua", ["path", "alias"])
      .whereColumn("ua", "path", paths);
    const aliasResult = await pool.query(aliasQuery.toString(), aliasQuery.params);

    for (const row of aliasResult.rows) {
      const instanceGuid = pathToGuid.get(row.path);
      if (!instanceGuid || row.alias === `instance/${instanceGuid}`) {
        continue;
      }
      if (!row.alias.startsWith("instance/")) {
        continue;
      }

      const segment = row.alias.slice("instance/".length);
      if (!segment || segment === instanceGuid) {
        continue;
      }

      const current = urlSegmentByGuid.get(instanceGuid);
      if (!current || row.alias.length < current.aliasLength || (
        row.alias.length === current.aliasLength && row.alias < current.alias
      )) {
        urlSegmentByGuid.set(instanceGuid, { segment, aliasLength: row.alias.length });
      }
    }
  }

  // 3. Resolve stored package guids to machine names for API responses.
  await Promise.all(instances.map((instance) => instance.resolvePackageNames()));

  // 4. Assemble the response.
  res.json({
    instances: instances.map((instance) => ({
      ...instance.toJSON(),
      packageNames: instance.packageNames,
      ...accessByGuid.get(instance.guid),
      urlSegment: urlSegmentByGuid.get(instance.guid)?.segment ?? null,
    })),
  });
}));

instancesRouter.post("/instances", asyncRoute(async (req, res) => {
  const name = trimmedString(req.body.name);
  const description = trimmedString(req.body.description);
  const selectedPackages = Array.isArray(req.body.packages) ? req.body.packages : null;
  const rawUrl = trimmedString(req.body.url);
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

  const packageSelection = await packagesFromMachineNames(selectedPackages);
  if (!packageSelection.valid) {
    res.status(400).json({
      error: packageSelection.errors[0] || "Invalid package selection",
      errors: packageSelection.errors,
    });
    return;
  }

  const savedInstance = await withTransaction(async () => {
    const client = getTransactionClient();
    const instanceStorage = InstanceStorage.global();
    const instance = await instanceStorage.create();
    instance.set({
      name,
      description,
      packages: packageSelection.packages,
    });

    const validationErrors = await instance.validate();
    if (validationErrors.length) {
      throw new ValidationError(validationErrors);
    }

    await instance.save();
    const instanceGuid = instance.guid;

    // Assign Instance_Owner role to the creator
    const ownerRoles = await RoleStorage.global().list({ name: "Instance_Owner", skipEvents: true });
    const ownerRole = ownerRoles[0];
    if (ownerRole) {
      await assignInstanceRole(req.session.user.guid, instanceGuid, ownerRole.guid);
    }

    await createDefaultInstanceAlias(client, instanceGuid);
    if (urlSegment) {
      await createCustomInstanceAlias(client, instanceGuid, urlSegment);
    }

    const catalog = await loadPackages({ strict: false });
    await instance.resolvePackageNames();
    await applyInstallForInstance(instance, catalog);

    return instance;
  });

  res.status(201).json({
    instance: {
      ...savedInstance.toJSON(),
      packageNames: savedInstance.packageNames,
      role: await isGlobalAdmin(req.session.user.guid) ? "Admin" : "Instance_Owner",
      canManageUsers: true,
      canDelete: true,
    },
  });
}));

instancesRouter.put("/instances/:guid", asyncRoute(async (req, res) => {
  const user = req.session.user;
  const instanceGuid = req.params.guid;
  const name = trimmedString(req.body.name);
  const description = trimmedString(req.body.description);
  const rawUrl = trimmedString(req.body.url);
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

  const currentUrlSegment = await lookupCustomInstanceUrlSegment(instanceGuid);

  const updatedInstance = await withTransaction(async () => {
    const client = getTransactionClient();
    const instanceStorage = InstanceStorage.global();
    const instance = await instanceStorage.load(instanceGuid, { skipEvents: true });
    if (!instance) {
      throw new NotFoundError("Instance not found");
    }

    instance.set({ name, description });
    const validationErrors = await instance.validate();
    if (validationErrors.length) {
      throw new ValidationError(validationErrors);
    }

    await instance.save();

    if (urlSegment !== currentUrlSegment) {
      await syncCustomInstanceAlias(client, instanceGuid, urlSegment);
    }

    return instance.resolvePackageNames();
  });

  const resolvedUrlSegment = await lookupCustomInstanceUrlSegment(instanceGuid);

  res.json({
    instance: {
      ...updatedInstance.toJSON(),
      packageNames: updatedInstance.packageNames,
      urlSegment: resolvedUrlSegment || null,
    },
  });
}));

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

    const users = await UserStorage.global().listForInstance(instanceGuid);

    res.json({
      users: users.map((entity) => ({
        guid: entity.guid,
        email: entity.email,
        displayName: entity.displayName,
        roleGuid: entity.instanceRoles[0]?.roleGuid ?? null,
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
    const { roleGuid } = req.body;

    if (!roleGuid || typeof roleGuid !== "string") {
      res.status(400).json({ error: "roleGuid is required" });
      return;
    }

    // Check manage_users permission
    const canManage = await userHasPermission(user.guid, instanceGuid, "instance.manage_users");
    if (!canManage) {
      res.status(403).json({ error: "You do not have permission to manage users on this instance" });
      return;
    }

    const role = await RoleStorage.global().load(roleGuid, { skipEvents: true });
    if (!role) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }

    const roleName = role.name;

    // GMs cannot assign Instance_Owner
    const isAdmin = await isGlobalAdmin(user.guid);
    if (!isAdmin) {
      const callerRole = await getUserInstanceRole(instanceGuid, user.guid);
      if (callerRole === "Instance_GM" && roleName === "Instance_Owner") {
        res.status(403).json({ error: "GMs cannot assign the Instance_Owner role" });
        return;
      }
    }

    await assignInstanceRole(targetUserGuid, instanceGuid, roleGuid);

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

    const targetUser = await UserStorage.global().load(targetUserGuid, { skipEvents: true });
    if (targetUser) {
      targetUser.set({
        instanceRoles: (targetUser.instanceRoles ?? []).filter(
          (entry) => entry.instanceGuid !== instanceGuid,
        ),
      });
      await targetUser.save({ skipEvents: true });
    }

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

    await withTransaction(async () => {
      const client = getTransactionClient();
      await deleteAliasesForInstance(client, instanceGuid);
      const deleted = await InstanceStorage.global().delete(instanceGuid);
      if (!deleted) {
        throw new NotFoundError("Instance not found");
      }
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = instancesRouter;
