/**
 * GenRPG package registry row (genrpg.packages).
 * Version columns are maintained by the update/install machinery, not entity forms.
 */
module.exports = {
  coreFields: {
    machineName: {
      type: "text",
      unique: true,
      readOnly: true,
      public: true,
    },
    version: {
      type: "integer",
      default: 0,
      readOnly: true,
      public: true,
    },
    installVersion: {
      type: "integer",
      default: 0,
      readOnly: true,
      public: true,
    },
  },
  fields: {},
};
