/**
 * Item template management — CRUD UI for instance item templates.
 */
class ManageItemTemplateModal extends Modal {
  constructor() {
    super("manage-item-template-modal", "Create Item Template", {
      maxWidth: "36rem",
      width: "92vw",
      enterAnimation: { preset: "scale-down", duration: 200 },
      exitAnimation: { preset: "scale-up", duration: 200 },
      classes: ["manage-item-template-modal"],
    });

    this.instanceGuid = null;
    this.templateGuid = null;
    this.onChanged = null;
    this.eventNs = ".manage-item-template-modal";
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

  isEditMode() {
    return Boolean(this.templateGuid);
  }

  getContent() {
    this.elements.$message = $("<p>", {
      class: "item-template-modal__message message",
      role: "status",
    });

    this.elements.$form = $("<form>", { class: "item-template-modal__form" }).append(
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
      $("<label>").append(
        $("<span>", { text: "Description" }),
        $("<textarea>", { name: "description", rows: 2, maxlength: 2000 }),
      ),
      $("<label>").append(
        $("<span>", { text: "Weight" }),
        $("<input>", { name: "weight", type: "number", step: "any", min: "0" }),
      ),
      this.elements.$message,
    );

    this.elements.$cancelButton = $("<button>", {
      type: "button",
      class: "secondary-button",
      text: "Cancel",
    });

    this.elements.$saveButton = $("<button>", {
      type: "button",
      class: "primary-button",
      text: "Save",
    });

    this.elements.$saveAndAddButton = $("<button>", {
      type: "submit",
      class: "primary-button",
      text: "Save and add another",
    });

    this.elements.$editSaveButton = $("<button>", {
      type: "submit",
      class: "primary-button",
      text: "Save",
    });

    this.elements.$actions = $("<div>", { class: "item-template-modal__actions" }).append(
      this.elements.$cancelButton,
      this.elements.$saveButton,
      this.elements.$saveAndAddButton,
      this.elements.$editSaveButton,
    );

    this.elements.$form.append(this.elements.$actions);

    this.elements.$form.on("submit" + this.eventNs, (event) => {
      event.preventDefault();
      void this.handleSave({ closeAfter: this.isEditMode() });
    });

    this.elements.$cancelButton.on("click" + this.eventNs, () => this.hide());
    this.elements.$saveButton.on("click" + this.eventNs, () => {
      void this.handleSave({ closeAfter: true });
    });

    return this.elements.$form;
  }

  configureActions() {
    if (!this.elements.$saveButton?.length) {
      return;
    }
    const isEdit = this.isEditMode();
    this.elements.$saveButton.prop("hidden", isEdit);
    this.elements.$saveAndAddButton.prop("hidden", isEdit);
    this.elements.$editSaveButton.prop("hidden", !isEdit);
  }

  prepareShow() {
    if (!this.domExists) {
      this.createModalElement();
      this.bindEvents();
    }
  }

  setFormMessage(text, tone) {
    const $message = this.elements.$message;
    if (!$message?.length) {
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
    this.elements.$form?.[0]?.reset();
    this.setFormMessage("");
  }

  fillForm(template) {
    const $form = this.elements.$form;
    $form.find('[name="name"]').val(template.name || "");
    $form.find('[name="description"]').val(template.description || "");
    $form.find('[name="weight"]').val(
      template.weight === null || template.weight === undefined ? "" : template.weight,
    );
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

  setSaving(disabled) {
    this.elements.$saveButton.prop("disabled", disabled);
    this.elements.$saveAndAddButton.prop("disabled", disabled);
    this.elements.$editSaveButton.prop("disabled", disabled);
    this.elements.$cancelButton.prop("disabled", disabled);
  }

  async handleSave({ closeAfter }) {
    const payload = this.readFormPayload();

    if (!payload.name) {
      this.setFormMessage("Name is required.", "error");
      return;
    }

    this.setSaving(true);

    try {
      if (this.isEditMode()) {
        await this.requestJson(`${this.apiBase()}/${this.templateGuid}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await this.requestJson(this.apiBase(), {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      if (this.onChanged) {
        await this.onChanged();
      }

      if (closeAfter) {
        this.hide();
        return;
      }

      this.resetForm();
      this.elements.$form.find('[name="name"]').trigger("focus");
    } catch (error) {
      this.setFormMessage(error.message, "error");
    } finally {
      this.setSaving(false);
    }
  }

  /**
   * @param {string} instanceGuid
   * @param {() => void|Promise<void>} onChanged
   */
  showCreate(instanceGuid, onChanged) {
    this.instanceGuid = instanceGuid;
    this.templateGuid = null;
    this.onChanged = onChanged;
    this.prepareShow();
    this.setTitle("Create Item Template");
    this.resetForm();
    this.configureActions();
    super.show();
    this.elements.$form.find('[name="name"]').trigger("focus");
  }

  /**
   * @param {string} instanceGuid
   * @param {Object} template
   * @param {() => void|Promise<void>} onChanged
   */
  showEdit(instanceGuid, template, onChanged) {
    this.instanceGuid = instanceGuid;
    this.templateGuid = template.guid;
    this.onChanged = onChanged;
    this.prepareShow();
    this.setTitle(`Edit — ${template.name || "Item Template"}`);
    this.resetForm();
    this.fillForm(template);
    this.configureActions();
    super.show();
    this.elements.$form.find('[name="name"]').trigger("focus");
  }

  onHide() {
    this.resetForm();
    this.instanceGuid = null;
    this.templateGuid = null;
    this.onChanged = null;
  }
}

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

  async loadTemplates() {
    const data = await this.requestJson(this.apiBase());
    if (!data) {
      return;
    }
    this.table.setData(data.itemTemplates || []);
  }

  async deleteTemplate(template) {
    if (!window.confirm("Delete this item template?")) {
      return;
    }

    try {
      await this.requestJson(`${this.apiBase()}/${template.guid}`, { method: "DELETE" });
      this.setMessage("Template deleted.", "success");
      await this.loadTemplates();
    } catch (error) {
      this.setMessage(error.message, "error");
    }
  }

  static getManageItemTemplateModal() {
    if (!ItemTemplateManagement._manageItemTemplateModal) {
      ItemTemplateManagement._manageItemTemplateModal = new ManageItemTemplateModal();
      ItemTemplateManagement._manageItemTemplateModal.init();
    }
    return ItemTemplateManagement._manageItemTemplateModal;
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
                class: "secondary-button item-template-actions__btn",
                title: "Edit",
                "aria-label": "Edit",
                text: "✏️",
              }).on("click", (event) => {
                event.stopPropagation();
                ItemTemplateManagement.getManageItemTemplateModal().showEdit(
                  this.instanceGuid,
                  row,
                  () => this.loadTemplates(),
                );
              }),
            );
            $container.append(
              $("<button>", {
                type: "button",
                class: "danger-button-outline item-template-actions__btn",
                title: "Delete",
                "aria-label": "Delete",
                text: "🗑️",
              }).on("click", (event) => {
                event.stopPropagation();
                void this.deleteTemplate(row);
              }),
            );
            return $container;
          },
        },
      ],
      emptyState: {
        message: "No item templates",
        icon: "",
        detailNoData: "Add a template using the button above.",
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

    const $header = $("<div>", { class: "item-template-management__header" });
    const $addButton = $("<button>", {
      type: "button",
      class: "primary-button item-template-management__add-btn",
      text: "Add Template",
    });
    $header.append(
      $("<h2>", { class: "item-template-management__heading", text: "Item Templates" }),
      $addButton,
    );

    const $message = $("<p>", {
      class: "item-template-management__message",
      role: "status",
    });

    const $tableHost = $("<div>", { class: "item-template-management__table" });
    $root.append($header, $message, $tableHost);

    this.elements.$root = $root;
    this.elements.$addButton = $addButton;
    this.elements.$message = $message;
    this.elements.$tableHost = $tableHost;

    return $root;
  }

  bindEvents() {
    const ns = this.eventNs;
    this.elements.$addButton.on("click" + ns, () => {
      ItemTemplateManagement.getManageItemTemplateModal().showCreate(
        this.instanceGuid,
        () => this.loadTemplates(),
      );
    });
  }

  unbindEvents() {
    this.elements.$addButton?.off(this.eventNs);
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

    this.table = null;
    this.isMounted = false;
    this.elements = {};
  }
}
