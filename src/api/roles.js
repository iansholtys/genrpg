const express = require("express");
const { requireAdmin } = require("../auth");
const { withTransaction } = require("../db/transactionContext");
const { trimmedString } = require("../lib/strings");
const { NotFoundError } = require("../errors/NotFoundError");
const { ValidationError } = require("../errors/ValidationError");
const { asyncRoute } = require("../lib/httpResponse");
const RoleStorage = require("../storage/roleStorage");
const PermissionStorage = require("../storage/permissionStorage");

const rolesRouter = express.Router();

function permissionGuidsFromBody(body) {
  if (!Array.isArray(body.permissionGuids)) {
    return [];
  }

  return body.permissionGuids.map((value) => trimmedString(value)).filter(Boolean);
}

async function roleToJson(role, permissionByGuid) {
  const map = permissionByGuid ?? await loadPermissionMap();
  const { guid, name, description } = role;
  const permissionGuids = (role.permissions ?? [])
    .map((entry) => entry?.value)
    .filter(Boolean);

  const permissions = permissionGuids
    .map((guid) => map.get(guid))
    .filter(Boolean)
    .map((permission) => ({
      guid: permission.guid,
      name: permission.name,
    }));

  return { guid, name, description, permissions };
}

async function loadPermissionMap() {
  const permissions = await PermissionStorage.global().list({ skipEvents: true });
  return new Map(permissions.map((permission) => [permission.guid, permission]));
}

async function rolesToJson(roles) {
  if (!roles.length) {
    return [];
  }

  const permissionByGuid = await loadPermissionMap();
  return Promise.all(roles.map((role) => roleToJson(role, permissionByGuid)));
}

rolesRouter.get("/roles", asyncRoute(async (req, res) => {
  const roles = await RoleStorage.global().list({ skipEvents: true });
  res.json({ roles: await rolesToJson(roles) });
}));

rolesRouter.get("/permissions", asyncRoute(async (req, res) => {
  const permissions = await PermissionStorage.global().list({ skipEvents: true });
  res.json({
    permissions: permissions.map((permission) => ({
      guid: permission.guid,
      name: permission.name,
      description: permission.description ?? "",
    })),
  });
}));

rolesRouter.post("/roles", requireAdmin, asyncRoute(async (req, res) => {
  const name = trimmedString(req.body.name);
  const description = trimmedString(req.body.description);
  const permissionGuids = permissionGuidsFromBody(req.body);

  if (!name) {
    res.status(400).json({ error: "Role name is required" });
    return;
  }

  const role = await withTransaction(async () => {
    const storage = RoleStorage.global();
    const entity = await storage.create();
    entity.set({
      name,
      description,
      permissions: permissionGuids.map((value) => ({ value })),
    });

    const validationErrors = await entity.validate();
    if (validationErrors.length) {
      throw new ValidationError(validationErrors);
    }

    await entity.save();
    return entity;
  });

  res.status(201).json({ role: await roleToJson(role) });
}));

rolesRouter.put("/roles/:guid", requireAdmin, asyncRoute(async (req, res) => {
  const roleGuid = req.params.guid;
  const name = trimmedString(req.body.name);
  const description = trimmedString(req.body.description);
  const permissionGuids = permissionGuidsFromBody(req.body);

  if (!name) {
    res.status(400).json({ error: "Role name is required" });
    return;
  }

  const role = await withTransaction(async () => {
    const storage = RoleStorage.global();
    const entity = await storage.load(roleGuid, { skipEvents: true });
    if (!entity) {
      throw new NotFoundError("Role not found");
    }

    entity.set({
      name,
      description,
      permissions: permissionGuids.map((value) => ({ value })),
    });

    const validationErrors = await entity.validate();
    if (validationErrors.length) {
      throw new ValidationError(validationErrors);
    }

    await entity.save();
    return entity;
  });

  res.json({ role: await roleToJson(role) });
}));

rolesRouter.delete("/roles/:guid", requireAdmin, asyncRoute(async (req, res) => {
  const roleGuid = req.params.guid;
  const usageCount = await RoleStorage.global().countUsersWithRole(roleGuid);

  if (usageCount > 0) {
    res.status(400).json({
      error: "Cannot delete this role because it is assigned to users on one or more instances",
    });
    return;
  }

  const deleted = await RoleStorage.global().delete(roleGuid);
  if (!deleted) {
    res.status(404).json({ error: "Role not found" });
    return;
  }

  res.json({ success: true });
}));

module.exports = rolesRouter;
