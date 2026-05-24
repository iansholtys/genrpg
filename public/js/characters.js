import { requestJson } from "./api.js";
import { getElements } from "./elements.js";
import { state } from "./state.js";
import { setMessage } from "./utils.js";

const Modal = window.Modal;

function characterName(character) {
  const core = character.packages?.genrpg || {};
  return core.display_name || core.full_name || character.guid;
}

function renderCharacterList(characters) {
  const elements = getElements();
  const $list = elements.$characterList.empty();

  if (!characters.length) {
    $list.append($("<p>", { class: "empty-state", text: "No characters yet." }));
    return;
  }

  for (const character of characters) {
    const core = character.packages?.genrpg || {};
    const packageNames = Object.entries(character.packages || {})
      .filter(([, value]) => value)
      .map(([schema]) => schema)
      .join(", ");

    $list.append(
      $("<article>", { class: "character-card" }).append(
        $("<h3>", { text: characterName(character) }),
        core.full_name && core.full_name !== core.display_name
          ? $("<p>", { class: "character-card__subtitle", text: core.full_name })
          : null,
        $("<p>", {
          class: "character-card__meta",
          text: packageNames ? `Data: ${packageNames}` : "Core data only",
        }),
      ),
    );
  }
}

async function loadCharacters(instanceGuid) {
  const { characters } = await requestJson(`/api/genrpg/instances/${instanceGuid}/characters`);
  renderCharacterList(characters || []);
}

function buildField(schema, column) {
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
        $fields.append(buildField(schema.schema, column));
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

  gatherPayload() {
    const packages = {};
    for (const schema of this.metadata.schemas || []) {
      packages[schema.schema] = {};
    }

    this.$form.find("input, textarea, select").each((_, element) => {
      const $input = $(element);
      const schema = $input.attr("data-schema");
      const name = $input.attr("name");
      if (!schema || !name) return;

      if ($input.attr("type") === "checkbox") {
        if ($input.prop("checked")) packages[schema][name] = true;
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
    setMessage(this.$message, "Creating character...");

    try {
      await requestJson(`/api/genrpg/instances/${this.instanceGuid}/characters`, {
        method: "POST",
        body: JSON.stringify(this.gatherPayload()),
      });
      this.hide();
      await this.onCreated();
    } catch (error) {
      setMessage(this.$message, error.message, "error");
    } finally {
      this.$submit.prop("disabled", false);
    }
  }
}

async function openCreateCharacterModal() {
  const instanceGuid = state.activeInstance?.guid;
  if (!instanceGuid) return;

  const metadata = await requestJson(`/api/genrpg/instances/${instanceGuid}/characters/form`);
  const modal = new CreateCharacterModal(instanceGuid, metadata, () => loadCharacters(instanceGuid));
  modal.show();
}

async function showCharacterWorkspace(instanceGuid, instanceName) {
  const elements = getElements();
  elements.$instancesHome.prop("hidden", true);
  elements.$administrationSection.prop("hidden", true);
  elements.$instanceWorkspace.prop("hidden", false);
  elements.$instanceTitle.text(instanceName || "Instance");
  setMessage(elements.$instanceMessage, "");

  try {
    await loadCharacters(instanceGuid);
  } catch (error) {
    setMessage(elements.$instanceMessage, error.message, "error");
  }
}

function hideCharacterWorkspace() {
  const elements = getElements();
  elements.$instanceWorkspace.prop("hidden", true);
  elements.$instancesHome.prop("hidden", false);
}

export function setupCharacterEvents() {
  $(document).on("click", "#createCharacterButton", () => {
    openCreateCharacterModal().catch((error) => {
      setMessage(getElements().$instanceMessage, error.message, "error");
    });
  });

  window.addEventListener("genrpg:instance-entered", (event) => {
    const { instanceGuid } = event.detail;
    showCharacterWorkspace(instanceGuid, state.activeInstance?.name).catch((error) => {
      setMessage(getElements().$instanceMessage, error.message, "error");
    });
  });

  window.addEventListener("genrpg:instance-exited", hideCharacterWorkspace);
}
