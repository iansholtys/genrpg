const { buildContext, hasPermission } = require("../services/permissionService");
const { NotFoundError } = require("../errors/NotFoundError");
const { PermissionError } = require("../errors/PermissionError");

const PERMISSION_VIEW = "instance.run";
const PERMISSION_EDIT = "instance.edit";
const INSTANCE_FIELDS = ["guid", "packages"];

async function assertInstancePermissions(req, permission, { fields = INSTANCE_FIELDS } = {}) {
  const context = await buildContext(req.session.user, req.params.instanceGuid, { fields });
  if (!context) {
    throw new NotFoundError("Instance not found");
  }
  if (!hasPermission(context, permission)) {
    throw new PermissionError();
  }
  return context;
}

module.exports = {
  PERMISSION_VIEW,
  PERMISSION_EDIT,
  INSTANCE_FIELDS,
  assertInstancePermissions,
};
