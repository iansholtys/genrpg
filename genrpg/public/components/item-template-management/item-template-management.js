/**
 * Item template management — CRUD UI for instance item templates.
 */
class ItemTemplateManagement {
  static defaultId = "genrpg-item-template-management";

  /**
   * @param {Object} options
   * @param {string} options.instanceGuid Instance the templates belong to.
   * @param {string} [options.id] Root element id.
   */
  constructor(options = {}) {
    if (!options.instanceGuid) {
      throw new Error("ItemTemplateManagement requires instanceGuid");
    }

    this.instanceGuid = options.instanceGuid;
    this.id = options.id || ItemTemplateManagement.defaultId;
    this.eventNs = ".item-template-management-" + this.id;

    this.editingGuid = null;
    this.table = null;
    this.isMounted = false;

    this.elements = {};
  }

  static escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      }[character];
    });
  }

  static formatWeight(value) {
    if (value === null || value === undefined) {
      return "—";
    }
    return String(value);
  }

  apiBase() {
    return `/api/genrpg/instances/${this.instanceGuid}/item-templates`;
  }

  async requestJson(url, options) {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });

    if (response.status === 401) {
      window.location.assign("/login");
      return null;
    }

    if (response.status === 204) {
      return {};
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    return data;
  }

  setMessage(text, tone) {
    const $message = this.elements.$message;
    if (!$message) {
      return;
    }
    $message.text(text || "");
    if (tone) {
      $message.attr("data-tone", tone);
    } else {
      $message.removeAttr("data-tone");
    }
  }

  resetForm() {
    this.editingGuid = null;
    if (this.elements.$form) {
      this.elements.$form[0].reset();
    }
    this.elements.$submitButton.text("Save");
    this.elements.$cancelButton.prop("hidden", true);
    this.setMessage("");
  }

  fillForm(template) {
    this.editingGuid = template.guid;
    const $form = this.elements.$form;
    $form.find('[name="name"]').val(template.name || "");
    $form.find('[name="description"]').val(template.description || "");
    $form.find('[name="weight"]').val(
      template.weight === null || template.weight === undefined ? "" : template.weight,
    );
    this.elements.$submitButton.text("Update");
    this.elements.$cancelButton.prop("hidden", false);
    this.setMessage("");
    $form.find('[name="name"]').trigger("focus");
  }

  readFormPayload() {
    const formData = new FormData(this.elements.$form[0]);
    const weightRaw = formData.get("weight");
    return {
      name: String(formData.get("name") || "").trim(),
      description: String(formData.get("description") || ""),
      weight: weightRaw === "" ? null : weightRaw,
    };
  }

  async loadTemplates() {
    const data = await this.requestJson(this.apiBase());
    if (!data) {
      return;
    }
    this.table.setData(data.itemTemplates || []);
  }

  ensureTable() {
    if (this.table) {
      return this.table;
    }

    this.table = new Table({
      id: "item-templates-table",
      rowCount: { show: true, nounSingular: "template", nounPlural: "templates" },
      searchPlaceholder: "Search templates…",
      defaultSort: { field: "name" },
      columns: [
        { title: "Name", searchable: true },
        {
          title: "Description",
          searchable: true,
          valueFunction: (row) => row.description || "",
          renderFunction: (value) => ItemTemplateManagement.escapeHtml(value || ""),
        },
        {
          title: "Weight",
          renderFunction: (value) =>
            ItemTemplateManagement.escapeHtml(ItemTemplateManagement.formatWeight(value)),
        },
        {
          title: "Actions",
          sortable: false,
          headerClass: "actions-cell",
          cellClass: "actions-cell",
          renderFunction: (_value, row) => {
            const $container = $("<div>", { class: "item-template-actions" });
            $container.append(
              $("<button>", {
                type: "button",
                class: "secondary-button item-template-actions__btn edit-item-template-btn",
                title: "Edit",
                "aria-label": "Edit",
                text: "✏️",
              }).attr("data-template-guid", row.guid),
            );
            $container.append(
              $("<button>", {
                type: "button",
                class: "danger-button-outline item-template-actions__btn delete-item-template-btn",
                title: "Delete",
                "aria-label": "Delete",
                text: "🗑️",
              }).attr("data-template-guid", row.guid),
            );
            return $container;
          },
        },
      ],
      emptyState: {
        message: "No item templates",
        icon: "",
        detailNoData: "Create a template using the form above.",
      },
    });

    this.elements.$tableHost.empty().append(this.table.init());
    return this.table;
  }

  buildRoot() {
    const $root = $("<section>", {
      id: this.id,
      class: "item-template-management",
      "aria-label": "Item template management",
    });

    $root.append($("<h2>", { class: "item-template-management__heading", text: "Item Templates" }));

    const $form = $("<form>", { class: "item-template-management__form" }).append(
      $("<label>").append(
        $("<span>", { text: "Name" }),
        $("<input>", {
          name: "name",
          type: "text",
          required: true,
          maxlength: 120,
          autocomplete: "off",
        }),
      ),
    );
    $form.append(
      $("<label>").append(
        $("<span>", { text: "Description" }),
        $("<textarea>", { name: "description", rows: 2, maxlength: 2000 }),
      ),
    );
    $form.append(
      $("<label>").append(
        $("<span>", { text: "Weight" }),
        $("<input>", { name: "weight", type: "number", step: "any", min: "0" }),
      ),
    );

    const $formActions = $("<div>", { class: "item-template-management__form-actions" });
    const $submitButton = $("<button>", { type: "submit", text: "Save" });
    const $cancelButton = $("<button>", {
      type: "button",
      class: "secondary-button",
      text: "Cancel",
      hidden: true,
    });
    $formActions.append($submitButton, $cancelButton);
    $form.append($formActions);

    const $message = $("<p>", {
      class: "item-template-management__message",
      role: "status",
    });

    const $tableHost = $("<div>", { class: "item-template-management__table" });
    $root.append($form, $message, $tableHost);

    this.elements.$root = $root;
    this.elements.$form = $form;
    this.elements.$message = $message;
    this.elements.$submitButton = $submitButton;
    this.elements.$cancelButton = $cancelButton;
    this.elements.$tableHost = $tableHost;

    return $root;
  }

  bindEvents() {
    const ns = this.eventNs;
    const { $form, $root, $cancelButton, $submitButton } = this.elements;

    $form.on("submit" + ns, async (event) => {
      event.preventDefault();
      const payload = this.readFormPayload();

      if (!payload.name) {
        this.setMessage("Name is required.", "error");
        return;
      }

      $submitButton.prop("disabled", true);

      try {
        if (this.editingGuid) {
          await this.requestJson(`${this.apiBase()}/${this.editingGuid}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          this.setMessage("Template updated.", "success");
        } else {
          await this.requestJson(this.apiBase(), {
            method: "POST",
            body: JSON.stringify(payload),
          });
          this.setMessage("Template created.", "success");
        }

        this.resetForm();
        await this.loadTemplates();
      } catch (error) {
        this.setMessage(error.message, "error");
      } finally {
        $submitButton.prop("disabled", false);
      }
    });

    $cancelButton.on("click" + ns, () => this.resetForm());

    $root.on("click" + ns, ".edit-item-template-btn", async (event) => {
      const templateGuid = $(event.currentTarget).attr("data-template-guid");
      try {
        const data = await this.requestJson(`${this.apiBase()}/${templateGuid}`);
        if (data?.itemTemplate) {
          this.fillForm(data.itemTemplate);
        }
      } catch (error) {
        this.setMessage(error.message, "error");
      }
    });

    $root.on("click" + ns, ".delete-item-template-btn", async (event) => {
      const templateGuid = $(event.currentTarget).attr("data-template-guid");
      if (!window.confirm("Delete this item template?")) {
        return;
      }

      try {
        await this.requestJson(`${this.apiBase()}/${templateGuid}`, { method: "DELETE" });
        if (this.editingGuid === templateGuid) {
          this.resetForm();
        }
        this.setMessage("Template deleted.", "success");
        await this.loadTemplates();
      } catch (error) {
        this.setMessage(error.message, "error");
      }
    });
  }

  unbindEvents() {
    const ns = this.eventNs;
    if (this.elements.$form) {
      this.elements.$form.off(ns);
    }
    if (this.elements.$cancelButton) {
      this.elements.$cancelButton.off(ns);
    }
    if (this.elements.$root) {
      this.elements.$root.off(ns);
    }
  }

  /**
   * Build DOM, wire events, and load data.
   * @returns {JQuery}
   */
  init() {
    if (this.isMounted) {
      return this.elements.$root;
    }

    this.buildRoot();
    this.ensureTable();
    this.bindEvents();
    this.resetForm();
    this.isMounted = true;

    this.loadTemplates().catch((error) => {
      this.setMessage(error.message, "error");
    });

    return this.elements.$root;
  }

  /**
   * Remove DOM and listeners.
   */
  destroy() {
    if (!this.isMounted) {
      return;
    }

    this.unbindEvents();
    this.elements.$root?.remove();

    this.editingGuid = null;
    this.table = null;
    this.isMounted = false;
    this.elements = {};
  }
}
