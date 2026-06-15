/**
 * Character management — CRUD UI for instance characters.
 */
class ManageCharacterModal extends Modal {
  constructor() {
    super("manage-character-modal", "Create Character", {
      maxWidth: "44rem",
      width: "94vw",
      enterAnimation: { preset: "scale-down", duration: 200 },
      exitAnimation: { preset: "scale-up", duration: 200 },
      classes: ["manage-character-modal"],
    });

    this.instanceGuid = null;
    this.characterGuid = null;
    this.metadata = null;
    this.onChanged = null;
    this.eventNs = ".manage-character-modal";
  }

  apiBase() {
    return `/api/genrpg/instances/${this.instanceGuid}/characters`;
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
    return Boolean(this.characterGuid);
  }

  buildField(field) {
    const id = `character-field-${field.key}`;
    const common = {
      id,
      name: field.key,
    };
    let $input;

    if (field.inputType === "textarea") {
      $input = $("<textarea>", { ...common, rows: 3 });
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
    this.elements.$createSubmit = $("<button>", {
      type: "submit",
      class: "primary-button",
      text: "Create Character",
    });
    this.elements.$editSubmit = $("<button>", {
      type: "submit",
      class: "primary-button",
      text: "Save",
    });
    this.elements.$cancelButton = $("<button>", {
      type: "button",
      class: "secondary-button",
      text: "Cancel",
    });

    this.elements.$form = $("<form>", { class: "character-form" });

    for (const group of this.metadata?.groups || []) {
      const $fields = $("<div>", { class: "character-form__fields" });
      for (const field of group.fields || []) {
        $fields.append(this.buildField(field));
      }

      this.elements.$form.append(
        $("<fieldset>", { class: "character-form__fieldset" }).append(
          $("<legend>", { text: group.label || group.id }),
          $fields.children().length
            ? $fields
            : $("<p>", { class: "empty-state", text: "No editable fields." }),
        ),
      );
    }

    this.elements.$actions = $("<div>", { class: "character-form__actions" }).append(
      this.elements.$cancelButton,
      this.elements.$createSubmit,
      this.elements.$editSubmit,
    );
    this.elements.$form.append(this.elements.$actions);

    this.elements.$form.on("submit" + this.eventNs, (event) => {
      event.preventDefault();
      void this.handleSubmit();
    });
    this.elements.$cancelButton.on("click" + this.eventNs, () => this.hide());

    return this.elements.$form;
  }

  configureActions() {
    const isEdit = this.isEditMode();
    this.elements.$createSubmit?.prop("hidden", isEdit);
    this.elements.$editSubmit?.prop("hidden", !isEdit);
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

  fillForm(character) {
    for (const group of this.metadata?.groups || []) {
      for (const field of group.fields || []) {
        const $input = this.elements.$form.find(`[name="${field.key}"]`);
        if (!$input.length) {
          continue;
        }

        const value = character[field.key];
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
  }

  readFormPayload() {
    const payload = {};

    for (const group of this.metadata?.groups || []) {
      for (const field of group.fields || []) {
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
          payload[field.key] = null;
          continue;
        }

        payload[field.key] = raw;
      }
    }

    return payload;
  }

  async handleSubmit() {
    this.setSaving(true);

    try {
      const payload = this.readFormPayload();
      if (this.isEditMode()) {
        await this.requestJson(`${this.apiBase()}/${this.characterGuid}`, {
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

      this.hide();
    } catch (error) {
      window.services?.notifications?.error(error.message);
    } finally {
      this.setSaving(false);
    }
  }

  setSaving(disabled) {
    this.elements.$createSubmit?.prop("disabled", disabled);
    this.elements.$editSubmit?.prop("disabled", disabled);
    this.elements.$cancelButton?.prop("disabled", disabled);
  }

  async loadFormMetadata() {
    const data = await this.requestJson(`${this.apiBase()}/form`);
    if (!data) {
      return false;
    }
    this.metadata = data;
    return true;
  }

  /**
   * @param {string} instanceGuid
   * @param {() => void|Promise<void>} onChanged
   */
  async showCreate(instanceGuid, onChanged) {
    this.instanceGuid = instanceGuid;
    this.characterGuid = null;
    this.onChanged = onChanged;
    this.setTitle("Create Character");

    const loaded = await this.loadFormMetadata();
    if (!loaded) {
      return;
    }

    this.prepareShow();
    this.resetForm();
    this.configureActions();
    super.show();
  }

  /**
   * @param {string} instanceGuid
   * @param {Object} row
   * @param {() => void|Promise<void>} onChanged
   */
  async showEdit(instanceGuid, row, onChanged) {
    this.instanceGuid = instanceGuid;
    this.characterGuid = row.guid;
    this.onChanged = onChanged;
    this.setTitle(`Edit — ${row.displayName || "Character"}`);

    const loaded = await this.loadFormMetadata();
    if (!loaded) {
      return;
    }

    this.prepareShow();
    this.resetForm();
    this.fillForm(row);
    this.configureActions();
    super.show();
  }

  onHide() {
    this.resetForm();
    this.instanceGuid = null;
    this.characterGuid = null;
    this.metadata = null;
    this.onChanged = null;
  }
}

class ManageInventoryModal extends Modal {
  constructor() {
    super("manage-inventory-modal", "Manage Inventory", {
      maxWidth: "52rem",
      width: "94vw",
      enterAnimation: { preset: "scale-down", duration: 200 },
      exitAnimation: { preset: "scale-up", duration: 200 },
      classes: ["manage-inventory-modal"],
    });

    this.instanceGuid = null;
    this.characterGuid = null;
    this.characterName = "";
    this.primaryCollectionGuid = null;
    this.inventoryTable = null;
    this.eventNs = ".manage-inventory-modal";
  }

  apiBase() {
    return `/api/genrpg/instances/${this.instanceGuid}`;
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

  static formatWeight(weight) {
    if (weight === null || weight === undefined || weight === "") {
      return "—";
    }
    return String(weight);
  }

  getContent() {
    this.elements.$itemSelect = $("<select>", {
      id: "manage-inventory-item-select",
      name: "itemGuid",
      required: true,
    }).append($("<option>", { value: "", text: "Select an item", disabled: true, selected: true }));

    this.elements.$pickUpButton = $("<button>", {
      type: "submit",
      class: "primary-button",
      text: "Pick Up",
    });

    this.elements.$pickUpForm = $("<form>", { class: "manage-inventory-modal__pickup" }).append(
      $("<label>", { for: "manage-inventory-item-select" }).append(
        $("<span>", { text: "Item on the ground" }),
        this.elements.$itemSelect,
      ),
      this.elements.$pickUpButton,
    );

    this.elements.$inventoryTableHost = $("<div>", {
      class: "manage-inventory-modal__inventory-table",
    });

    this.elements.$closeButton = $("<button>", {
      type: "button",
      class: "secondary-button",
      text: "Close",
    });

    this.elements.$pickUpForm.on("submit" + this.eventNs, (event) => {
      event.preventDefault();
      void this.handlePickUp();
    });
    this.elements.$closeButton.on("click" + this.eventNs, () => this.hide());

    return $("<div>", { class: "manage-inventory-modal__body" }).append(
      this.elements.$pickUpForm,
      $("<h3>", { class: "manage-inventory-modal__heading", text: "Carried items" }),
      this.elements.$inventoryTableHost,
      $("<div>", { class: "manage-inventory-modal__footer" }).append(this.elements.$closeButton),
    );
  }

  prepareShow() {
    if (!this.domExists) {
      this.createModalElement();
      this.bindEvents();
    }
  }

  setBusy(busy) {
    this.elements.$pickUpButton?.prop("disabled", busy);
    this.elements.$itemSelect?.prop("disabled", busy);
    this.elements.$closeButton?.prop("disabled", busy);
  }

  ensureInventoryTable() {
    if (this.inventoryTable) {
      return this.inventoryTable;
    }

    this.inventoryTable = new Table({
      id: "character-inventory-table",
      rowCount: { show: true, nounSingular: "item", nounPlural: "items" },
      searchPlaceholder: "Search inventory…",
      defaultSort: { field: "name" },
      columns: [
        { title: "Name", searchable: true },
        {
          title: "Description",
          searchable: true,
          sortable: false,
          valueFunction: (_row, value) => value || "—",
        },
        {
          title: "Weight",
          valueFunction: (_row, value) => ManageInventoryModal.formatWeight(value),
        },
        {
          title: "Actions",
          sortable: false,
          headerClass: "actions-cell",
          cellClass: "actions-cell",
          renderFunction: (_value, row) => {
            return $("<button>", {
              type: "button",
              class: "secondary-button",
              text: "Drop",
            }).on("click", (event) => {
              event.stopPropagation();
              void this.handleDrop(row);
            });
          },
        },
      ],
      emptyState: {
        message: "No items",
        icon: "",
        detailNoData: "Pick up an item using the form above.",
      },
    });

    this.elements.$inventoryTableHost.empty().append(this.inventoryTable.init());
    return this.inventoryTable;
  }

  async loadCharacter() {
    const data = await this.requestJson(`${this.apiBase()}/characters/${this.characterGuid}`);
    return data?.character ?? null;
  }

  primaryCollectionFromCharacter(character) {
    const inventories = character?.inventories || [];
    const primary = inventories.find((entry) => entry.type === "inventory") || inventories[0];
    return primary?.collectionGuid ?? null;
  }

  async loadContainedItemGuids() {
    const collectionsData = await this.requestJson(`${this.apiBase()}/item-collections`);
    if (!collectionsData) {
      return new Set();
    }

    const contained = new Set();

    for (const collection of collectionsData.itemCollections || []) {
      for (const content of collection.contents || []) {
        if (content.itemGuid) {
          contained.add(content.itemGuid);
        }
      }
    }

    return contained;
  }

  async loadAvailableItems() {
    const [itemsData, containedGuids] = await Promise.all([
      this.requestJson(`${this.apiBase()}/items`),
      this.loadContainedItemGuids(),
    ]);
    if (!itemsData) {
      return [];
    }

    return (itemsData.items || []).filter((item) => !containedGuids.has(item.guid));
  }

  populateItemSelect(items) {
    const $select = this.elements.$itemSelect;
    $select.empty();
    $select.append(
      $("<option>", { value: "", text: "Select an item", disabled: true, selected: true }),
    );

    for (const item of items) {
      const label = item.name ?? item.itemTemplate?.name ?? item.guid;
      $select.append($("<option>", { value: item.guid, text: label }));
    }
  }

  async loadInventoryRows(character) {
    const [itemsData, collectionsData] = await Promise.all([
      this.requestJson(`${this.apiBase()}/items`),
      this.requestJson(`${this.apiBase()}/item-collections`),
    ]);
    if (!character || !itemsData || !collectionsData) {
      return [];
    }

    const itemsByGuid = new Map((itemsData.items || []).map((item) => [item.guid, item]));
    const collectionsByGuid = new Map(
      (collectionsData.itemCollections || []).map((collection) => [collection.guid, collection]),
    );
    const rows = [];

    for (const inventory of character.inventories || []) {
      const collection = collectionsByGuid.get(inventory.collectionGuid);
      if (!collection) {
        continue;
      }

      for (const [contentIndex, content] of (collection.contents || []).entries()) {
        if (!content.itemGuid) {
          continue;
        }

        const item = itemsByGuid.get(content.itemGuid);
        rows.push({
          contentIndex,
          collectionGuid: inventory.collectionGuid,
          itemGuid: content.itemGuid,
          name: item?.name ?? item?.itemTemplate?.name ?? content.itemGuid,
          description: item?.description ?? item?.itemTemplate?.description ?? "",
          weight:
            item?.weight !== null && item?.weight !== undefined
              ? item.weight
              : (item?.itemTemplate?.weight ?? null),
        });
      }
    }

    return rows;
  }

  async refresh() {
    this.setBusy(true);

    try {
      const character = await this.loadCharacter();
      this.primaryCollectionGuid = this.primaryCollectionFromCharacter(character);
      const [availableItems, inventoryRows] = await Promise.all([
        this.loadAvailableItems(),
        this.loadInventoryRows(character),
      ]);

      this.populateItemSelect(availableItems);
      this.ensureInventoryTable().setData(inventoryRows);
    } catch (error) {
      window.services?.notifications?.error(error.message);
    } finally {
      this.setBusy(false);
    }
  }

  async handlePickUp() {
    const itemGuid = this.elements.$itemSelect?.val();
    if (!itemGuid) {
      window.services?.notifications?.error("Select an item to pick up.");
      return;
    }

    if (!this.primaryCollectionGuid) {
      window.services?.notifications?.error("This character has no inventory collection.");
      return;
    }

    this.setBusy(true);

    try {
      const collectionData = await this.requestJson(
        `${this.apiBase()}/item-collections/${this.primaryCollectionGuid}`,
      );
      if (!collectionData?.itemCollection) {
        throw new Error("Inventory collection not found.");
      }

      const contents = [...(collectionData.itemCollection.contents || [])];
      contents.push({ itemGuid, quantity: 1 });

      await this.requestJson(
        `${this.apiBase()}/item-collections/${this.primaryCollectionGuid}`,
        {
          method: "PUT",
          body: JSON.stringify({ contents }),
        },
      );
      await this.refresh();
      window.services?.notifications?.success("Item picked up.");
    } catch (error) {
      window.services?.notifications?.error(error.message);
      this.setBusy(false);
    }
  }

  async handleDrop(row) {
    if (!window.confirm(`Drop ${row.name || "this item"}?`)) {
      return;
    }

    this.setBusy(true);

    try {
      const collectionData = await this.requestJson(
        `${this.apiBase()}/item-collections/${row.collectionGuid}`,
      );
      if (!collectionData?.itemCollection) {
        throw new Error("Inventory collection not found.");
      }

      const contents = [...(collectionData.itemCollection.contents || [])];
      contents.splice(row.contentIndex, 1);

      await this.requestJson(
        `${this.apiBase()}/item-collections/${row.collectionGuid}`,
        {
          method: "PUT",
          body: JSON.stringify({ contents }),
        },
      );
      await this.refresh();
      window.services?.notifications?.success("Item dropped.");
    } catch (error) {
      window.services?.notifications?.error(error.message);
      this.setBusy(false);
    }
  }

  /**
   * @param {string} instanceGuid
   * @param {Object} row
   */
  async show(instanceGuid, row) {
    this.instanceGuid = instanceGuid;
    this.characterGuid = row.guid;
    this.characterName = row.displayName || "Character";
    this.setTitle(`Manage Inventory — ${this.characterName}`);

    this.prepareShow();
    this.ensureInventoryTable();
    super.show();
    await this.refresh();
  }

  onHide() {
    this.instanceGuid = null;
    this.characterGuid = null;
    this.characterName = "";
    this.primaryCollectionGuid = null;
    this.elements.$itemSelect?.empty();
    this.inventoryTable?.setData([]);
  }
}

class CharacterManagement {
  static defaultId = "genrpg-character-management";

  /**
   * @param {Object} options
   * @param {string} options.instanceGuid
   * @param {string} [options.id]
   */
  constructor(options = {}) {
    if (!options.instanceGuid) {
      throw new Error("CharacterManagement requires instanceGuid");
    }

    this.instanceGuid = options.instanceGuid;
    this.id = options.id || CharacterManagement.defaultId;
    this.eventNs = ".character-management-" + this.id;

    this.table = null;
    this.isMounted = false;
    this.elements = {};
  }

  static appearancePreview(text, maxLength = 200) {
    const value = String(text ?? "");
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength)}…`;
  }

  static rowFromCharacter(character) {
    return {
      ...character,
      displayName: character.displayName || character.fullName || character.guid,
      pronouns: character.pronouns || "",
      appearance: character.appearance || "",
    };
  }

  apiBase() {
    return `/api/genrpg/instances/${this.instanceGuid}/characters`;
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

  async loadCharacters() {
    const data = await this.requestJson(this.apiBase());
    if (!data) {
      return;
    }

    const rows = (data.characters || []).map((character) =>
      CharacterManagement.rowFromCharacter(character),
    );
    this.table.setData(rows);
  }

  async deleteCharacter(row) {
    if (!window.confirm("Delete this character?")) {
      return;
    }

    try {
      await this.requestJson(`${this.apiBase()}/${row.guid}`, { method: "DELETE" });
      window.services?.notifications?.success("Character deleted.");
      await this.loadCharacters();
    } catch (error) {
      window.services?.notifications?.error(error.message);
    }
  }

  static getManageCharacterModal() {
    if (!CharacterManagement._manageCharacterModal) {
      CharacterManagement._manageCharacterModal = new ManageCharacterModal();
      CharacterManagement._manageCharacterModal.init();
    }
    return CharacterManagement._manageCharacterModal;
  }

  static getManageInventoryModal() {
    if (!CharacterManagement._manageInventoryModal) {
      CharacterManagement._manageInventoryModal = new ManageInventoryModal();
      CharacterManagement._manageInventoryModal.init();
    }
    return CharacterManagement._manageInventoryModal;
  }

  ensureTable() {
    if (this.table) {
      return this.table;
    }

    this.table = new Table({
      id: "instance-characters-table",
      rowCount: { show: true, nounSingular: "character", nounPlural: "characters" },
      searchPlaceholder: "Search characters…",
      defaultSort: { field: "displayName" },
      columns: [
        { title: "Display Name", searchable: true },
        {
          title: "Pronouns",
          searchable: true,
          valueFunction: (_row, value) => value || "—",
        },
        {
          title: "Appearance",
          searchable: true,
          valueFunction: (_row, value) => CharacterManagement.appearancePreview(value || ""),
        },
        {
          title: "Actions",
          sortable: false,
          headerClass: "actions-cell",
          cellClass: "actions-cell",
          renderFunction: (_value, row) => {
            const $container = $("<div>", { class: "character-actions" });
            $container.append(
              $("<button>", {
                type: "button",
                class: "secondary-button character-actions__btn",
                title: "Edit",
                "aria-label": "Edit",
                text: "✏️",
              }).on("click", (event) => {
                event.stopPropagation();
                void CharacterManagement.getManageCharacterModal().showEdit(
                  this.instanceGuid,
                  row,
                  () => this.loadCharacters(),
                );
              }),
            );
            $container.append(
              $("<button>", {
                type: "button",
                class: "secondary-button character-actions__btn",
                title: "Manage Inventory",
                "aria-label": "Manage Inventory",
                text: "🎒",
              }).on("click", (event) => {
                event.stopPropagation();
                void CharacterManagement.getManageInventoryModal().show(this.instanceGuid, row);
              }),
            );
            $container.append(
              $("<button>", {
                type: "button",
                class: "danger-button-outline character-actions__btn",
                title: "Delete",
                "aria-label": "Delete",
                text: "🗑️",
              }).on("click", (event) => {
                event.stopPropagation();
                void this.deleteCharacter(row);
              }),
            );
            return $container;
          },
        },
      ],
      emptyState: {
        message: "No characters",
        icon: "",
        detailNoData: "Add a character using the button above.",
      },
    });

    this.elements.$tableHost.empty().append(this.table.init());
    return this.table;
  }

  buildRoot() {
    const $root = $("<section>", {
      id: this.id,
      class: "character-management",
      "aria-label": "Character management",
    });

    const $toolbar = $("<div>", { class: "character-management__toolbar" });
    const $addButton = $("<button>", {
      type: "button",
      class: "primary-button character-management__add-btn",
      text: "Add Character",
    });
    $toolbar.append($addButton);

    const $tableHost = $("<div>", { class: "character-management__table" });
    $root.append($toolbar, $tableHost);

    this.elements.$root = $root;
    this.elements.$toolbar = $toolbar;
    this.elements.$addButton = $addButton;
    this.elements.$tableHost = $tableHost;

    return $root;
  }

  bindEvents() {
    const ns = this.eventNs;
    this.elements.$addButton.on("click" + ns, () => {
      void CharacterManagement.getManageCharacterModal().showCreate(this.instanceGuid, () =>
        this.loadCharacters(),
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

    this.loadCharacters().catch((error) => {
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
