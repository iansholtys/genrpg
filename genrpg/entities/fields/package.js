/**
 * GenRPG package registry row (genrpg.packages).
 * Version columns are maintained by the update/install machinery, not entity forms.
 */
module.exports = {
  coreFields: {
    machineName: {
      column: "package",
      readOnly: true,
      public: true,
    },
    version: {
      column: "version",
      readOnly: true,
      public: true,
    },
    installVersion: {
      column: "install_version",
      readOnly: true,
      public: true,
    },
  },
  fields: {},
};
