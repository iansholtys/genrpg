/**
 * GenRPG core fields on user.
 * Field-table data: genrpg.user_<field> (see src/fields/).
 * Core fields: base-table columns on genrpg.users (see coreFields below).
 */
module.exports = {
  coreFields: {
    oidcIssuer: {
      type: "text",
      createOnly: true,
    },
    oidcSubject: {
      type: "text",
      createOnly: true,
    },
  },
  uniqueConstraints: [
    ["oidcIssuer", "oidcSubject"],
  ],
  fields: {
    email: {
      type: "text",
      label: "Email",
    },
    displayName: {
      type: "text",
      label: "Display name",
    },
    admin: {
      type: "boolean",
      label: "Admin",
      default: false,
    },
    instanceRoles: {
      type: "instanceRole",
      label: "Instance roles",
      cardinality: 0,
    },
  },
};
