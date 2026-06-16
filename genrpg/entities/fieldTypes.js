/**
 * GenRPG core field types.
 */
module.exports = {
  fieldTypes: {
    text: {
      columns: [{ name: "value", type: "text" }],
    },
    integer: {
      columns: [{ name: "value", type: "integer" }],
    },
    number: {
      columns: [{ name: "value", type: "double precision" }],
    },
    boolean: {
      columns: [{ name: "value", type: "boolean" }],
    },
    entityRef: {
      columns: [{ name: "value", type: "uuid" }],
    },
    richText: {
      columns: [{ name: "value", type: "text" }],
    },
    collectionContent: {
      defaultSortColumn: "itemGuid",
      columns: [
        { name: "item_guid", type: "uuid", refs: "item" },
        { name: "subcollection_guid", type: "uuid", refs: "item_collection" },
        { name: "quantity", type: "integer", nullable: false, default: "1" },
      ],
    },
    inventoryLink: {
      defaultSortColumn: "name",
      columns: [
        { name: "collection_guid", type: "uuid", nullable: false, refs: "item_collection" },
        { name: "name", type: "text" },
        { name: "type", type: "text" },
      ],
    },
    packageInstall: {
      defaultSortColumn: "packageGuid",
      columns: [
        { name: "package_guid", type: "uuid", nullable: false, refs: "package" },
        { name: "install_version", type: "integer", nullable: false, default: "0" },
      ],
    },
  },
};
