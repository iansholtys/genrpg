/**
 * Item management — CRUD UI for instance items (template + optional overrides).
 */
class ManageItemModal extends Modal {
  constructor() {
    super("manage-item-modal", "Create Item", {
      maxWidth: "36rem",
      width: "92vw",
      enterAnimation: { preset: "scale-down", duration: 200 },
      exitAnimation: { preset: "scale-up", duration: 200 },
      classes: ["manage-item-modal"],
    });

    this.instanceGuid = null;
    this.itemGuid = null;
    this.templates = [];
    this.onChanged = null;
    this.eventNs = ".manage-item-modal";
  }

  apiBase() {
    return `/api/genrpg/instances/${this.instanceGuid}/items`;
  }

  templatesApiBase() {
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
    return Boolean(this.itemGuid);
  }

  getContent() {
    this.elements.$templateSelect = $("<select>", {
      name: "itemTemplateGuid",
      required: true,
    }).append($("<option>", { value: "", text: "Select a template", disabled: true, selected: true }));

    this.elements.$form = $("<form>", { class: "item-modal__form" }).append(
      $("<label>").append(
        $("<span>", { text: "Template" }),
        this.elements.$templateSelect,
      ),
      $("<p>", {
        class: "item-modal__hint",
        text: "Optional overrides — leave blank to use the template value.",
      }),
      $("<label>").append(
        $("<span>", { text: "Name" }),
        $("<input>", {
          name: "name",
          type: "text",
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

    this.elements.$actions = $("<div>", { class: "item-modal__actions" }).append(
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

  populateTemplateSelect(selectedGuid) {
    const $select = this.elements.$templateSelect;
    $select.empty();
    $select.append($("<option>", { value: "", text: "Select a template", disabled: true }));

    if (!this.templates.length) {
      $select.append($("<option>", { value: "", text: "No templates available", disabled: true }));
      $select.prop("disabled", true);
      return;
    }

    $select.prop("disabled", false);
    for (const template of this.templates) {
      $select.append(
        $("<option>", {
          value: template.guid,
          text: template.name || template.guid,
          selected: template.guid === selectedGuid,
        }),
      );
    }

    if (selectedGuid) {
      $select.val(selectedGuid);
    }
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

  resetForm() {
    this.elements.$form?.[0]?.reset();
    this.populateTemplateSelect(null);
  }

  fillForm(item) {
    const $form = this.elements.$form;
    this.populateTemplateSelect(item.itemTemplateGuid);
    $form.find('[name="name"]').val(item.name || "");
    $form.find('[name="description"]').val(item.description || "");
    $form.find('[name="weight"]').val(
      item.weight === null || item.weight === undefined ? "" : item.weight,
    );
  }

  readFormPayload() {
    const formData = new FormData(this.elements.$form[0]);
    const weightRaw = formData.get("weight");
    const nameRaw = formData.get("name");
    const descriptionRaw = formData.get("description");

    return {
      itemTemplateGuid: String(formData.get("itemTemplateGuid") || "").trim(),
      name: nameRaw === "" || nameRaw === null ? null : String(nameRaw).trim(),
      description:
        descriptionRaw === "" || descriptionRaw === null ? null : String(descriptionRaw),
      weight: weightRaw === "" ? null : weightRaw,
    };
  }

  setSaving(disabled) {
    this.elements.$saveButton.prop("disabled", disabled);
    this.elements.$saveAndAddButton.prop("disabled", disabled);
    this.elements.$editSaveButton.prop("disabled", disabled);
    this.elements.$cancelButton.prop("disabled", disabled);
  }

  async loadTemplates() {
    const data = await this.requestJson(this.templatesApiBase());
    if (!data) {
      return false;
    }
    this.templates = data.itemTemplates || [];
    return true;
  }

  async handleSave({ closeAfter }) {
    const payload = this.readFormPayload();

    if (!payload.itemTemplateGuid) {
      window.services?.notifications?.error("Template is required.");
      return;
    }

    if (!this.templates.length) {
      window.services?.notifications?.error("Create an item template before adding items.");
      return;
    }

    this.setSaving(true);

    try {
      if (this.isEditMode()) {
        await this.requestJson(`${this.apiBase()}/${this.itemGuid}`, {
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
      this.populateTemplateSelect(null);
      this.elements.$form.find('[name="itemTemplateGuid"]').trigger("focus");
    } catch (error) {
      window.services?.notifications?.error(error.message);
    } finally {
      this.setSaving(false);
    }
  }

  /**
   * @param {string} instanceGuid
   * @param {() => void|Promise<void>} onChanged
   */
  async showCreate(instanceGuid, onChanged) {
    this.instanceGuid = instanceGuid;
    this.itemGuid = null;
    this.onChanged = onChanged;
    this.prepareShow();
    this.setTitle("Create Item");
    this.resetForm();

    const loaded = await this.loadTemplates();
    if (!loaded) {
      return;
    }

    this.populateTemplateSelect(null);
    this.configureActions();
    super.show();
    this.elements.$templateSelect.trigger("focus");
  }

  /**
   * @param {string} instanceGuid
   * @param {Object} item
   * @param {() => void|Promise<void>} onChanged
   */
  async showEdit(instanceGuid, item, onChanged) {
    this.instanceGuid = instanceGuid;
    this.itemGuid = item.guid;
    this.onChanged = onChanged;
    this.prepareShow();
    this.setTitle(`Edit — ${item.effectiveName || "Item"}`);
    this.resetForm();

    const loaded = await this.loadTemplates();
    if (!loaded) {
      return;
    }

    this.fillForm(item);
    this.configureActions();
    super.show();
    this.elements.$templateSelect.trigger("focus");
  }

  onHide() {
    this.resetForm();
    this.instanceGuid = null;
    this.itemGuid = null;
    this.templates = [];
    this.onChanged = null;
  }
}

class ItemManagement {
  static defaultId = "genrpg-item-management";

  /**
   * @param {Object} options
   * @param {string} options.instanceGuid
   * @param {string} [options.id]
   */
  constructor(options = {}) {
    if (!options.instanceGuid) {
      throw new Error("ItemManagement requires instanceGuid");
    }

    this.instanceGuid = options.instanceGuid;
    this.id = options.id || ItemManagement.defaultId;
    this.eventNs = ".item-management-" + this.id;

    this.table = null;
    this.isMounted = false;
    this.elements = {};
  }

  static formatWeight(value) {
    if (value === null || value === undefined) {
      return "—";
    }
    return String(value);
  }

  apiBase() {
    return `/api/genrpg/instances/${this.instanceGuid}/items`;
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

  async loadItems() {
    const data = await this.requestJson(this.apiBase());
    if (!data) {
      return;
    }
    this.table.setData(data.items || []);
  }

  async deleteItem(item) {
    if (!window.confirm("Delete this item?")) {
      return;
    }

    try {
      await this.requestJson(`${this.apiBase()}/${item.guid}`, { method: "DELETE" });
      window.services?.notifications?.success("Item deleted.");
      await this.loadItems();
    } catch (error) {
      window.services?.notifications?.error(error.message);
    }
  }

  static getManageItemModal() {
    if (!ItemManagement._manageItemModal) {
      ItemManagement._manageItemModal = new ManageItemModal();
      ItemManagement._manageItemModal.init();
    }
    return ItemManagement._manageItemModal;
  }

  ensureTable() {
    if (this.table) {
      return this.table;
    }

    this.table = new Table({
      id: "instance-items-table",
      rowCount: { show: true, nounSingular: "item", nounPlural: "items" },
      searchPlaceholder: "Search items…",
      defaultSort: { field: "effectiveName" },
      columns: [
        { title: "Name", field: "effectiveName", searchable: true },
        {
          title: "Description",
          field: "effectiveDescription",
          searchable: true,
          valueFunction: (_row, value) => value || "",
        },
        {
          title: "Weight",
          field: "effectiveWeight",
          valueFunction: (_row, value) => ItemManagement.formatWeight(value),
        },
        {
          title: "Template",
          searchable: true,
          valueFunction: (row) => row.itemTemplate?.name || "—",
        },
        {
          title: "Actions",
          sortable: false,
          headerClass: "actions-cell",
          cellClass: "actions-cell",
          renderFunction: (_value, row) => {
            const $container = $("<div>", { class: "item-actions" });
            $container.append(
              $("<button>", {
                type: "button",
                class: "secondary-button item-actions__btn",
                title: "Edit",
                "aria-label": "Edit",
                text: "✏️",
              }).on("click", (event) => {
                event.stopPropagation();
                void ItemManagement.getManageItemModal().showEdit(
                  this.instanceGuid,
                  row,
                  () => this.loadItems(),
                );
              }),
            );
            $container.append(
              $("<button>", {
                type: "button",
                class: "danger-button-outline item-actions__btn",
                title: "Delete",
                "aria-label": "Delete",
                text: "🗑️",
              }).on("click", (event) => {
                event.stopPropagation();
                void this.deleteItem(row);
              }),
            );
            return $container;
          },
        },
      ],
      emptyState: {
        message: "No items",
        icon: "",
        detailNoData: "Add an item using the button above.",
      },
    });

    this.elements.$tableHost.empty().append(this.table.init());
    return this.table;
  }

  buildRoot() {
    const $root = $("<section>", {
      id: this.id,
      class: "item-management",
      "aria-label": "Item management",
    });

    const $header = $("<div>", { class: "item-management__header" });
    const $addButton = $("<button>", {
      type: "button",
      class: "primary-button item-management__add-btn",
      text: "Add Item",
    });
    $header.append(
      $("<h2>", { class: "item-management__heading", text: "Items" }),
      $addButton,
    );

    const $tableHost = $("<div>", { class: "item-management__table" });
    $root.append($header, $tableHost);

    this.elements.$root = $root;
    this.elements.$addButton = $addButton;
    this.elements.$tableHost = $tableHost;

    return $root;
  }

  bindEvents() {
    const ns = this.eventNs;
    this.elements.$addButton.on("click" + ns, () => {
      void ItemManagement.getManageItemModal().showCreate(this.instanceGuid, () =>
        this.loadItems(),
      );
    });
  }

  unbindEvents() {
    this.elements.$addButton?.off(this.eventNs);
  }

  /**
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

    this.loadItems().catch((error) => {
      window.services?.notifications?.error(error.message);
    });

    return this.elements.$root;
  }

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
