/**
 * GenRPG URL alias entity — alias and path live on genrpg.url_aliases.
 */
module.exports = {
  coreFields: {
    alias: {
      type: "text",
      label: "Alias",
      public: true,
    },
    path: {
      type: "text",
      label: "Path",
      public: true,
    },
    isCanonical: {
      type: "boolean",
      label: "Canonical",
      default: false,
    },
  },
  uniqueConstraints: [
    ["alias"],
  ],
};
