const PermissionStorage = require("../src/storage/permissionStorage");
const RoleStorage = require("../src/storage/roleStorage");
const { importJsonEntities } = require("../src/lib/seedImport");

module.exports = {
  global: {
    1: async (ctx) => {
      const permissions = await ctx.loadSeedJson("seed/permissions.json");
      await importJsonEntities(PermissionStorage.global(), permissions, {
        refs: ctx,
        entityKey: "permission",
      });

      const roles = await ctx.loadSeedJson("seed/roles.json");
      await importJsonEntities(RoleStorage.global(), roles, {
        refs: ctx,
        entityKey: "role",
        resolveRecord: (record) => ({
          name: record.name,
          description: record.description,
          permissions: (record.permissions ?? []).map((permissionName) => ({
            value: ctx.resolveRef("permission", permissionName),
          })),
        }),
      });
    },
  },
};
