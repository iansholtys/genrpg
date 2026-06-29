const { BaseStorage } = require("../../src/storage/baseStorage");
const UrlAliasEntity = require("../entities/urlAlias");
const { normalizeAlias } = require("../entities/urlAlias");

class UrlAliasStorage extends BaseStorage {
  static schema = "genrpg";
  static table = "url_aliases";
  static Entity = UrlAliasEntity;

  static get instanceScoped() {
    return false;
  }

  /**
   * Load the alias row for a public path (e.g. instance/my-game).
   * Normalizes the lookup key; returns null when the input is empty or unknown.
   */
  async loadByAlias(alias, options = {}) {
    const normalized = normalizeAlias(alias);
    if (!normalized) {
      return null;
    }

    const entities = await this.list({ alias: normalized, skipEvents: true, ...options });
    return entities[0] ?? null;
  }

  /**
   * Mark one alias as canonical for its internal path and demote siblings.
   * Uses {@link BaseStorage#saveCoreRow} so sibling demotion skips entity validation.
   */
  async setCanonical(entity) {
    if (!entity?.path) {
      return entity;
    }

    const canonicals = await this.list({
      path: entity.path,
      isCanonical: true,
      skipEvents: true,
    });

    for (const sibling of canonicals) {
      if (sibling.guid === entity.guid) {
        continue;
      }

      sibling.isCanonical = false;
      await this.saveCoreRow(sibling);
    }

    if (!entity.isCanonical) {
      entity.isCanonical = true;
      await this.saveCoreRow(entity);
    }

    return entity;
  }
}

module.exports = UrlAliasStorage;
