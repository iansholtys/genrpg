/**
 * Items tab panel — instance items and item templates in one view.
 */
class ItemsPanel {
  static defaultId = "genrpg-items-panel";

  /**
   * @param {Object} options
   * @param {string} options.instanceGuid
   * @param {string} [options.id]
   */
  constructor(options = {}) {
    if (!options.instanceGuid) {
      throw new Error("ItemsPanel requires instanceGuid");
    }

    this.instanceGuid = options.instanceGuid;
    this.id = options.id || ItemsPanel.defaultId;
    this.itemManagement = null;
    this.itemTemplateManagement = null;
    this.isMounted = false;
    this.elements = {};
  }

  buildRoot() {
    const $root = $("<div>", {
      id: this.id,
      class: "items-panel",
      "aria-label": "Items",
    });

    const $itemsSection = $("<div>", { class: "items-panel__items" });
    const $templatesSection = $("<div>", { class: "items-panel__templates" });

    $root.append($itemsSection, $templatesSection);

    this.elements.$root = $root;
    this.elements.$itemsSection = $itemsSection;
    this.elements.$templatesSection = $templatesSection;

    return $root;
  }

  /**
   * @returns {JQuery}
   */
  init() {
    if (this.isMounted) {
      return this.elements.$root;
    }

    this.buildRoot();

    this.itemManagement = new ItemManagement({
      instanceGuid: this.instanceGuid,
    });
    this.itemTemplateManagement = new ItemTemplateManagement({
      instanceGuid: this.instanceGuid,
    });

    this.elements.$itemsSection.append(this.itemManagement.init());
    this.elements.$templatesSection.append(this.itemTemplateManagement.init());

    this.isMounted = true;
    return this.elements.$root;
  }

  destroy() {
    if (!this.isMounted) {
      return;
    }

    this.itemManagement?.destroy();
    this.itemTemplateManagement?.destroy();
    this.itemManagement = null;
    this.itemTemplateManagement = null;

    this.elements.$root?.remove();
    this.isMounted = false;
    this.elements = {};
  }
}
