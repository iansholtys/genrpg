/**
 * Character management — CRUD UI for instance characters.
 */
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

  static appearancePreview(text, maxLength = 200) {
    const value = String(text ?? "");
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength)}…`;
  }

  static rowFromCharacter(character) {
    const core = character.packages?.genrpg || {};
    return {
      guid: character.guid,
      displayName: core.display_name || core.full_name || character.guid,
      pronouns: core.pronouns || "",
      appearance: core.appearance || "",
      packages: character.packages || {},
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
      this.setMessage("Character deleted.", "success");
      await this.loadCharacters();
    } catch (error) {
      this.setMessage(error.message, "error");
    }
  }

  static getManageCharacterModal() {
    if (!CharacterManagement._manageCharacterModal) {
      CharacterManagement._manageCharacterModal = new ManageCharacterModal();
      CharacterManagement._manageCharacterModal.init();
    }
    return CharacterManagement._manageCharacterModal;
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
        {
          title: "Display Name",
          field: "displayName",
          searchable: true,
          renderFunction: (value) => CharacterManagement.escapeHtml(value || ""),
        },
        {
          title: "Pronouns",
          field: "pronouns",
          searchable: true,
          renderFunction: (value) => CharacterManagement.escapeHtml(value || "—"),
        },
        {
          title: "Appearance",
          field: "appearance",
          searchable: true,
          valueFunction: (row) => row.appearance || "",
          renderFunction: (value) =>
            CharacterManagement.escapeHtml(CharacterManagement.appearancePreview(value)),
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

    const $message = $("<p>", {
      class: "character-management__message",
      role: "status",
    });

    const $tableHost = $("<div>", { class: "character-management__table" });
    $root.append($toolbar, $message, $tableHost);

    this.elements.$root = $root;
    this.elements.$toolbar = $toolbar;
    this.elements.$addButton = $addButton;
    this.elements.$message = $message;
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
      this.setMessage(error.message, "error");
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

  buildField(schema, column) {
    const id = `character-${schema}-${column.name}`;
    const common = {
      id,
      name: column.name,
    };
    let $input;

    if (column.inputType === "textarea") {
      $input = $("<textarea>", { ...common, rows: 3 });
    } else if (column.inputType === "select") {
      $input = $("<select>", common).append(
        $("<option>", { value: "", text: column.required ? "Select one" : "None" }),
      );
      for (const option of column.options || []) {
        $input.append($("<option>", { value: option.value, text: option.label }));
      }
    } else if (column.inputType === "checkbox") {
      $input = $("<input>", { ...common, type: "checkbox", value: "true" });
    } else {
      $input = $("<input>", { ...common, type: column.inputType || "text" });
    }

    if (column.required) {
      $input.prop("required", true);
    }

    return $("<label>", { for: id }).append(
      $("<span>", { text: column.label || column.name }),
      $input.attr("data-schema", schema),
    );
  }

  getContent() {
    this.elements = {};

    this.elements.$message = $("<div>", { class: "character-form__message message", role: "status" });
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

    this.elements.$form = $("<form>", { class: "character-form" }).append(this.elements.$message);

    for (const schema of this.metadata.schemas || []) {
      const $fields = $("<div>", { class: "character-form__fields" });
      for (const column of schema.columns || []) {
        $fields.append(this.buildField(schema.schema, column));
      }

      this.elements.$form.append(
        $("<fieldset>", { class: "character-form__fieldset" }).append(
          $("<legend>", { text: schema.label || schema.schema }),
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

  gatherPayload() {
    const packages = {};
    for (const schema of this.metadata.schemas || []) {
      packages[schema.schema] = {};
    }

    this.elements.$form.find("input, textarea, select").each((_, element) => {
      const $input = $(element);
      const schema = $input.attr("data-schema");
      const name = $input.attr("name");
      if (!schema || !name) {
        return;
      }

      if ($input.attr("type") === "checkbox") {
        if ($input.prop("checked")) {
          packages[schema][name] = true;
        }
        return;
      }

      const value = $input.val();
      if (value !== null && value !== undefined && value !== "") {
        packages[schema][name] = value;
      }
    });

    return { packages };
  }

  async handleSubmit() {
    this.setSaving(true);
    this.setFormMessage(this.isEditMode() ? "Saving character..." : "Creating character...");

    try {
      const payload = this.gatherPayload();
      if (this.isEditMode()) {
        await this.requestJson(`${this.apiBase()}/${this.characterGuid}`, {
          method: "PATCH",
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
      this.setFormMessage(error.message, "error");
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

    // Form fields come from /form metadata (labels, types) — not character values.
    // Apply row.packages so edit mode shows current data (inverse of gatherPayload).
    const packageData = row.packages && typeof row.packages === "object" ? row.packages : {};
    this.elements.$form.find("input, textarea, select").each((_, element) => {
      const $input = $(element);
      const schema = $input.attr("data-schema");
      const name = $input.attr("name");
      if (!schema || !name) {
        return;
      }

      const value = packageData[schema]?.[name];
      if ($input.attr("type") === "checkbox") {
        $input.prop("checked", Boolean(value));
        return;
      }

      if (value === null || value === undefined) {
        $input.val("");
        return;
      }

      $input.val(String(value));
    });

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
