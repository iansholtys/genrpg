/**
 * GenRPG permission entity fields.
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
  },
};
