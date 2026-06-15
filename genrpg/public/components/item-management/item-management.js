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
    this.metadata = null;
    this.onChanged = null;
    this.eventNs = ".manage-item-modal";
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

  isEditMode() {
    return Boolean(this.itemGuid);
  }

  formFields() {
    return this.metadata?.fields || [];
  }

  findField(key) {
    return this.formFields().find((entry) => entry.key === key) ?? null;
  }

  buildField(field) {
    const id = `item-field-${field.key}`;
    const common = {
      id,
      name: field.key,
    };
    let $input;

    if (field.inputType === "textarea") {
      $input = $("<textarea>", { ...common, rows: 2, maxlength: 2000 });
    } else if (field.inputType === "select") {
      $input = $("<select>", common).append(
        $("<option>", {
          value: "",
          text: field.required ? "Select one" : "None",
          disabled: field.required,
          selected: true,
        }),
      );
      for (const option of field.options || []) {
        $input.append($("<option>", { value: option.value, text: option.label }));
      }
    } else if (field.inputType === "checkbox") {
      $input = $("<input>", { ...common, type: "checkbox", value: "true" });
    } else {
      const attrs = { ...common, type: field.inputType || "text" };
      if (field.inputType === "number") {
        attrs.step = field.step || "any";
        if (field.key === "weight") {
          attrs.min = "0";
        }
      }
      if (field.key === "name") {
        attrs.maxlength = 120;
        attrs.autocomplete = "off";
      }
      $input = $("<input>", attrs);
    }

    if (field.required) {
      $input.prop("required", true);
    }

    return $("<label>", { for: id }).append(
      $("<span>", { text: field.label || field.key }),
      $input,
    );
  }

  getContent() {
    this.elements.$form = $("<form>", { class: "item-modal__form" });

    const $fields = $("<div>", { class: "item-modal__fields" });
    for (const field of this.formFields()) {
      $fields.append(this.buildField(field));
      if (field.key === "itemTemplateGuid") {
        $fields.append(
          $("<p>", {
            class: "item-modal__hint",
            text: "Optional overrides — leave blank to use the template value.",
          }),
        );
      }
    }

    this.elements.$form.append(
      $fields.children().length
        ? $fields
        : $("<p>", { class: "empty-state", text: "No editable fields." }),
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

  configureActions() {
    if (!this.elements.$saveButton?.length) {
      return;
    }
    const isEdit = this.isEditMode();
    this.elements.$saveButton.prop("hidden", isEdit);
    this.elements.$saveAndAddButton.prop("hidden", isEdit);
    this.elements.$editSaveButton.prop("hidden", !isEdit);
  }

  rebuildFormContent() {
    if (!this.domExists || !this.metadata) {
      return;
    }

    this.elements.$form?.off(this.eventNs);
    this.fillBody(this.getContent());
  }

  prepareShow() {
    if (!this.domExists) {
      this.createModalElement();
      this.bindEvents();
      return;
    }

    this.rebuildFormContent();
  }

  resetForm() {
    this.elements.$form?.[0]?.reset();
  }

  fillForm(item) {
    for (const field of this.formFields()) {
      const $input = this.elements.$form.find(`[name="${field.key}"]`);
      if (!$input.length) {
        continue;
      }

      const value = item[field.key];
      if (field.inputType === "checkbox") {
        $input.prop("checked", Boolean(value));
        continue;
      }

      if (value === null || value === undefined) {
        $input.val("");
        continue;
      }

      $input.val(String(value));
    }
  }

  readFormPayload() {
    const payload = {};

    for (const field of this.formFields()) {
      const $input = this.elements.$form.find(`[name="${field.key}"]`);
      if (!$input.length) {
        continue;
      }

      if (field.inputType === "checkbox") {
        if ($input.prop("checked")) {
          payload[field.key] = true;
        }
        continue;
      }

      const raw = $input.val();
      if (raw === null || raw === undefined || raw === "") {
        payload[field.key] = field.key === "itemTemplateGuid" ? "" : null;
        continue;
      }

      payload[field.key] = raw;
    }

    if (payload.itemTemplateGuid !== undefined) {
      payload.itemTemplateGuid = String(payload.itemTemplateGuid || "").trim();
    }

    return payload;
  }

  setSaving(disabled) {
    this.elements.$saveButton.prop("disabled", disabled);
    this.elements.$saveAndAddButton.prop("disabled", disabled);
    this.elements.$editSaveButton.prop("disabled", disabled);
    this.elements.$cancelButton.prop("disabled", disabled);
  }

  async loadFormMetadata() {
    const data = await this.requestJson(`${this.apiBase()}/form`);
    if (!data) {
      return false;
    }
    this.metadata = data;
    return true;
  }

  async handleSave({ closeAfter }) {
    const payload = this.readFormPayload();
    const templateField = this.findField("itemTemplateGuid");

    if (!payload.itemTemplateGuid) {
      window.services?.notifications?.error("Template is required.");
      return;
    }

    if (templateField && !(templateField.options || []).length) {
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
    this.setTitle("Create Item");

    const loaded = await this.loadFormMetadata();
    if (!loaded) {
      return;
    }

    this.prepareShow();
    this.resetForm();
    this.configureActions();
    super.show();
    this.elements.$form.find('[name="itemTemplateGuid"]').trigger("focus");
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
    this.setTitle(`Edit — ${ItemManagement.displayName(item) || "Item"}`);

    const loaded = await this.loadFormMetadata();
    if (!loaded) {
      return;
    }

    this.prepareShow();
    this.resetForm();
    this.fillForm(item);
    this.configureActions();
    super.show();
    this.elements.$form.find('[name="itemTemplateGuid"]').trigger("focus");
  }

  onHide() {
    this.resetForm();
    this.instanceGuid = null;
    this.itemGuid = null;
    this.metadata = null;
    this.onChanged = null;
  }
}

class ItemManagement {
  static defaultId = "genrpg-item-management";
  static tableFieldKeys = new Set(["itemTemplateGuid", "name", "description", "weight"]);

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

    this.formMetadata = null;
    this.table = null;
    this.isMounted = false;
    this.elements = {};
  }

  static displayName(item) {
    return item?.name ?? item?.itemTemplate?.name ?? "";
  }

  static displayDescription(item) {
    return item?.description ?? item?.itemTemplate?.description ?? "";
  }

  static displayWeight(item) {
    if (item?.weight !== null && item?.weight !== undefined) {
      return item.weight;
    }
    return item?.itemTemplate?.weight ?? null;
  }

  static formatWeight(value) {
    if (value === null || value === undefined) {
      return "—";
    }
    return String(value);
  }

  static formatFieldValue(value) {
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

  async loadFormMetadata() {
    const data = await this.requestJson(`${this.apiBase()}/form`);
    if (!data) {
      return false;
    }
    this.formMetadata = data;
    return true;
  }

  getExtensionColumns() {
    const columns = [];

    for (const field of this.formMetadata?.fields || []) {
      if (ItemManagement.tableFieldKeys.has(field.key)) {
        continue;
      }

      columns.push({
        title: field.label || field.key,
        field: field.key,
        searchable: field.type === "text",
        valueFunction: (_row, value) => ItemManagement.formatFieldValue(value),
      });
    }

    return columns;
  }

  buildTableColumns() {
    return [
      {
        title: "Name",
        searchable: true,
        valueFunction: (row) => ItemManagement.displayName(row),
      },
      {
        title: "Description",
        searchable: true,
        valueFunction: (row) => ItemManagement.displayDescription(row) || "",
      },
      {
        title: "Weight",
        valueFunction: (row) => ItemManagement.formatWeight(ItemManagement.displayWeight(row)),
      },
      {
        title: "Template",
        searchable: true,
        valueFunction: (row) => row.itemTemplate?.name || "—",
      },
      ...this.getExtensionColumns(),
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
    ];
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
      defaultSort: { field: "name" },
      columns: this.buildTableColumns(),
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

  async bootstrap() {
    try {
      await this.loadFormMetadata();
      this.ensureTable();
      await this.loadItems();
    } catch (error) {
      window.services?.notifications?.error(error.message);
    }
  }

  /**
   * @returns {JQuery}
   */
  init() {
    if (this.isMounted) {
      return this.elements.$root;
    }

    this.buildRoot();
    this.bindEvents();
    this.isMounted = true;
    void this.bootstrap();

    return this.elements.$root;
  }

  destroy() {
    if (!this.isMounted) {
      return;
    }

    this.unbindEvents();
    this.elements.$root?.remove();

    this.formMetadata = null;
    this.table = null;
    this.isMounted = false;
    this.elements = {};
  }
}
