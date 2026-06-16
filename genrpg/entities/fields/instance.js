/**
 * GenRPG core fields on instance.
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
    },
    packages: {
      type: "packageInstall",
      label: "Packages",
      cardinality: 0,
      required: true,
    },
  },
};
