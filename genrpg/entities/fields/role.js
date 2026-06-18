/**
 * GenRPG role entity fields.
 */
module.exports = {
  fields: {
    name: {
      type: "text",
      label: "Name",
      required: true,
    },
    description: {
      type: "text",
      label: "Description",
      default: "",
    },
    permissions: {
      type: "entityRef",
      refs: "permission",
      label: "Permissions",
      cardinality: 0,
    },
  },
};
