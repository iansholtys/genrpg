/**
 * GenRPG core fields on item_collection.
 * Field-table data: genrpg.item_collection_<field> (see src/fields/).
 */
module.exports = {
  fields: {
    type: {
      type: "text",
      label: "Type",
      required: true,
    },
    name: {
      type: "text",
      label: "Name",
    },
    itemGuid: {
      type: "entityRef",
      label: "Item",
      refs: "item",
    },
    capacityUsed: {
      type: "number",
      label: "Capacity used",
    },
    capacityMax: {
      type: "number",
      label: "Capacity max",
    },
    contents: {
      type: "collectionContent",
      label: "Contents",
      cardinality: 0,
    },
  },
};
