/**
 * GenRPG core fields on user.
 * Field-table data: genrpg.user_<field> (see src/fields/).
 * Core fields: base-table columns on genrpg.users (see coreFields below).
 */
module.exports = {
  coreFields: {
    oidcIssuer: {
      column: "oidc_issuer",
      createOnly: true,
    },
    oidcSubject: {
      column: "oidc_subject",
      createOnly: true,
    },
  },
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
  },
};
