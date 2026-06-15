/**
 * GenRPG core fields on character.
 * Tables created at install: genrpg.character_<field> (see src/fields/).
 */
module.exports = {
  fields: {
    userGuid: {
      type: "entityRef",
      label: "User",
      refs: "user",
    },
    displayName: {
      type: "text",
      label: "Display name",
    },
    fullName: {
      type: "text",
      label: "Full name",
    },
    appearance: {
      type: "text",
      label: "Appearance",
      inputType: "textarea",
    },
    pronouns: {
      type: "text",
      label: "Pronouns",
    },
    inventories: {
      type: "inventoryLink",
      label: "Inventories",
      cardinality: 0,
    },
  },
};
