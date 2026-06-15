/**
 * GenRPG core fields on item_template.
 * Field-table data: genrpg.item_template_<field> (see src/fields/).
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
      inputType: "textarea",
    },
    weight: {
      type: "number",
      label: "Weight",
    },
  },
};
