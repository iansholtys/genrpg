/**
 * Character management — table of instance characters and create modal.
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

  async openCreateModal() {
    const metadata = await this.requestJson(`${this.apiBase()}/form`);
    if (!metadata) {
      return;
    }

    const modal = new CreateCharacterModal(
      this.instanceGuid,
      metadata,
      () => this.loadCharacters(),
    );
    modal.show();
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
      this.openCreateModal().catch((error) => {
        this.setMessage(error.message, "error");
      });
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

class CreateCharacterModal extends Modal {
  constructor(instanceGuid, metadata, onCreated) {
    super("create-character-modal", "Create Character", {
      maxWidth: "44rem",
      width: "94vw",
      enterAnimation: { preset: "scale-down", duration: 200 },
      exitAnimation: { preset: "scale-up", duration: 200 },
      classes: ["create-character-modal"],
    });
    this.instanceGuid = instanceGuid;
    this.metadata = metadata;
    this.onCreated = onCreated;
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
    this.$message = $("<div>", { class: "message", role: "status" });
    this.$submit = $("<button>", {
      type: "submit",
      class: "primary-button",
      text: "Create Character",
    });
    this.$form = $("<form>", { class: "character-form" }).append(this.$message);

    for (const schema of this.metadata.schemas || []) {
      const $fields = $("<div>", { class: "character-form__fields" });
      for (const column of schema.columns || []) {
        $fields.append(this.buildField(schema.schema, column));
      }

      this.$form.append(
        $("<fieldset>", { class: "character-form__fieldset" }).append(
          $("<legend>", { text: schema.label || schema.schema }),
          $fields.children().length
            ? $fields
            : $("<p>", { class: "empty-state", text: "No editable fields." }),
        ),
      );
    }

    this.$form.append(this.$submit);
    this.$form.on("submit", (event) => this.handleSubmit(event));
    return this.$form;
  }

  setFormMessage(text, tone) {
    this.$message.text(text || "");
    if (tone) {
      this.$message.attr("data-tone", tone);
    } else {
      this.$message.removeAttr("data-tone");
    }
  }

  gatherPayload() {
    const packages = {};
    for (const schema of this.metadata.schemas || []) {
      packages[schema.schema] = {};
    }

    this.$form.find("input, textarea, select").each((_, element) => {
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

  async handleSubmit(event) {
    event.preventDefault();
    this.$submit.prop("disabled", true);
    this.setFormMessage("Creating character...");

    try {
      const response = await fetch(`/api/genrpg/instances/${this.instanceGuid}/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.gatherPayload()),
      });

      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Request failed");
      }

      this.hide();
      await this.onCreated();
    } catch (error) {
      this.setFormMessage(error.message, "error");
    } finally {
      this.$submit.prop("disabled", false);
    }
  }
}
