/**
 * GenRPG core fields on item.
 * Field-table data: genrpg.item_<field> (see src/fields/).
 */
module.exports = {
  fields: {
    itemTemplateGuid: {
      type: "entityRef",
      label: "Item template",
      refs: "item_template",
      required: true,
    },
    name: {
      type: "text",
      label: "Name",
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
