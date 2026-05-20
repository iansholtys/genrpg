/**
 * App layout — shell for the package-visible instance view (header, content, footer).
 */
class AppLayout {
  static defaultId = "app-layout";

  /**
   * @param {Object} [options]
   * @param {string} [options.id] Root element id.
   * @param {{ floating?: null | "left" | "right" | "center" }} [options.header]
   * @param {{ floating?: null | "left" | "right" | "center" }} [options.footer]
   */
  constructor(options = {}) {
    this.id = options.id || AppLayout.defaultId;
    this.config = {
      header: { floating: AppLayout.normalizeFloating(options.header?.floating) },
      footer: { floating: AppLayout.normalizeFloating(options.footer?.floating) },
    };

    this.isBuilt = false;
    this.elements = {
      $root: null,
      $header: null,
      $content: null,
      $footer: null,
    };
  }

  static normalizeFloating(value) {
    if (value === "left" || value === "right" || value === "center") {
      return value;
    }
    return null;
  }

  applyFloatingClass($element, region, floating) {
    if (!floating) {
      return;
    }

    $element.addClass(`app-layout__${region}--floating-${floating}`);
  }

  /**
   * Build layout DOM.
   * @returns {JQuery}
   */
  build() {
    if (this.isBuilt) {
      return this.elements.$root;
    }

    const $root = $("<div>", {
      id: this.id,
      class: "app-layout",
    });

    const $header = $("<header>", { class: "app-layout__header" });
    const $content = $("<main>", { class: "app-layout__content" });
    const $footer = $("<footer>", { class: "app-layout__footer" });

    this.applyFloatingClass($header, "header", this.config.header.floating);
    this.applyFloatingClass($footer, "footer", this.config.footer.floating);

    $root.append($header, $content, $footer);

    this.elements.$root = $root;
    this.elements.$header = $header;
    this.elements.$content = $content;
    this.elements.$footer = $footer;
    this.isBuilt = true;

    return $root;
  }

  /**
   * @param {"header" | "content" | "footer"} name
   * @returns {JQuery}
   */
  getSection(name) {
    if (!this.isBuilt) {
      throw new Error("AppLayout is not built");
    }

    if (name === "header") {
      return this.elements.$header;
    }
    if (name === "content") {
      return this.elements.$content;
    }
    if (name === "footer") {
      return this.elements.$footer;
    }

    throw new Error(`AppLayout unknown section: ${name}`);
  }

  /**
   * Remove layout from the DOM.
   */
  destroy() {
    if (!this.isBuilt) {
      return;
    }

    this.elements.$root?.remove();
    this.elements.$root = null;
    this.elements.$header = null;
    this.elements.$content = null;
    this.elements.$footer = null;
    this.isBuilt = false;
  }
}
