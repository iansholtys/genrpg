const { BaseEntity } = require("../../src/entities/baseEntity");
const { trimmedString } = require("../../src/lib/strings");

const RESERVED_ALIAS_PREFIXES = ["api", "static", "auth", "login", "logout", "healthz"];

/**
 * Strip leading and trailing slashes from a public URL path.
 * Call this at API and write boundaries before {@link UrlAliasEntity#set}.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeAlias(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.replace(/^\/+|\/+$/g, "");
}

class UrlAliasEntity extends BaseEntity {
  static key = "url_alias";
  static labelProperties = ["alias"];

  static getStorage() {
    return require("../storage/urlAliasStorage");
  }

  /**
   * Require alias and path, reject reserved prefixes, and ensure alias uniqueness.
   * Assumes {@link normalizeAlias} was already applied to the alias being saved.
   */
  async collectValidationErrors() {
    const errors = await super.collectValidationErrors();

    const {alias, path, guid} = this;
    if (!trimmedString(alias)) {
      errors.push("Alias is required");
      return errors;
    }

    const firstSegment = alias.split("/")[0].toLowerCase();
    if (RESERVED_ALIAS_PREFIXES.includes(firstSegment)) {
      errors.push("Alias uses a reserved path prefix");
    }

    if (!trimmedString(path)) {
      errors.push("Path is required");
    }

    if (errors.length) {
      return errors;
    }

    const UrlAliasStorage = require("../storage/urlAliasStorage");
    const [existing] = await UrlAliasStorage.global().list({ alias, skipEvents: true });
    if (existing && existing.guid !== guid) {
      errors.push("Alias is already in use");
    }

    return errors;
  }
}

module.exports = UrlAliasEntity;
module.exports.normalizeAlias = normalizeAlias;
