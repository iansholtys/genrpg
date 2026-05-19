import { getElements } from "../../../js/elements.js";
import { requestJson } from "../../../js/api.js";
import { setMessage } from "../../../js/utils.js";
import { loadApp } from "../../../js/app.js";
import {
  applyPackageSelectionChange,
  getSelectedPackages,
  renderInstancePackageSelection,
} from "../../../js/packages.js";
import {
  slugifyInstanceUrlSegment,
  isProperlySlugified,
  instanceAliasFromSegment,
} from "../../../js/slug.js";

const Modal = window.Modal;
const ALIAS_CHECK_DEBOUNCE_MS = 300;

class CreateInstanceModal extends Modal {
  constructor() {
    super("create-instance-modal", "Create Instance", {
      maxWidth: "36rem",
      width: "92vw",
      enterAnimation: { preset: "scale-down", duration: 200 },
      exitAnimation: { preset: "scale-up", duration: 200 },
      classes: ["create-instance-modal"],
    });

    this.aliasInUse = false;
    this.aliasCheckPending = false;
    this.aliasCheckGeneration = 0;
    this.aliasCheckTimer = null;
    this.lastCheckedUrlSegment = "";
  }

  getContent() {
    this.elements.$createInstanceMessage = $("<div>", {
      id: "createInstanceMessage",
      class: "message",
      role: "status",
    });

    this.elements.$createInstanceNameInput = $("<input>", {
      type: "text",
      name: "name",
      required: true,
      maxlength: 120,
      autocomplete: "off",
    });

    this.elements.$createInstanceUrlInput = $("<input>", {
      type: "text",
      name: "url",
      maxlength: 120,
      autocomplete: "off",
    });

    this.elements.$createInstanceUrlHelp = $("<p>", {
      class: "create-instance-url-help",
      "aria-live": "polite",
    });

    this.elements.$createInstanceDescriptionInput = $("<textarea>", {
      name: "description",
      rows: 3,
      maxlength: 600,
    });

    this.elements.$createInstancePackageList = $("<div>", {
      id: "createInstancePackageList",
      class: "package-list",
      role: "group",
      "aria-label": "Packages",
    });

    this.elements.$createInstanceSubmitButton = $("<button>", {
      type: "submit",
      class: "primary-button",
      text: "Create Instance",
    });

    this.elements.$createInstanceForm = $("<form>", {
      id: "createInstanceForm",
      class: "create-instance-form",
    }).append(
      $("<label>").append(
        $("<span>", { text: "Name" }),
        this.elements.$createInstanceNameInput,
      ),
      $("<label>", { class: "create-instance-url-label" }).append(
        $("<span>", { text: "URL" }),
        this.elements.$createInstanceUrlInput,
        this.elements.$createInstanceUrlHelp,
      ),
      $("<label>").append(
        $("<span>", { text: "Description" }),
        this.elements.$createInstanceDescriptionInput,
      ),
      $("<fieldset>", { class: "create-instance-packages-fieldset" }).append(
        $("<legend>", { text: "Packages" }),
        this.elements.$createInstancePackageList,
      ),
      this.elements.$createInstanceMessage,
      this.elements.$createInstanceSubmitButton,
    );

    return this.elements.$createInstanceForm;
  }

  bindEvents() {
    super.bindEvents();
    this.elements.$createInstanceForm.on("submit", (event) => this.onSubmit(event));
    this.elements.$createInstanceNameInput.on("input", () => this.onNameInput());
    this.elements.$createInstanceUrlInput.on("input", () => this.onUrlInput());
    this.elements.$createInstanceUrlInput.on("blur", () => this.onUrlBlur());
    this.elements.$createInstancePackageList.on("change", 'input[name="package"]', (event) => {
      const input = event.currentTarget;
      if (input.dataset.machineName === "genrpg") {
        return;
      }
      applyPackageSelectionChange(input.value, input.checked, this.elements.$createInstancePackageList);
    });
  }

  getSiteBase() {
    return window.location.origin;
  }

  getUrlSegment() {
    return slugifyInstanceUrlSegment(this.elements.$createInstanceUrlInput.val());
  }

  cancelAliasCheckTimer() {
    if (this.aliasCheckTimer) {
      clearTimeout(this.aliasCheckTimer);
      this.aliasCheckTimer = null;
    }
  }

  updateSubmitDisabled() {
    const disabled = this.aliasInUse || this.aliasCheckPending;
    this.elements.$createInstanceSubmitButton.prop("disabled", disabled);
  }

  setUrlHelp(message, tone = "neutral") {
    this.elements.$createInstanceUrlHelp.text(message).attr("data-tone", tone);
  }

  updateUrlHelpForEmpty() {
    this.aliasInUse = false;
    this.aliasCheckPending = false;
    this.lastCheckedUrlSegment = "";
    this.setUrlHelp("Optional. Leave blank for an auto-generated URL.", "neutral");
    this.updateSubmitDisabled();
  }

  updateUrlHelpForAvailable(segment) {
    this.aliasInUse = false;
    this.aliasCheckPending = false;
    this.lastCheckedUrlSegment = segment;
    const base = this.getSiteBase();
    this.setUrlHelp(`Your instance will be at ${base}/instance/${segment}`, "neutral");
    this.updateSubmitDisabled();
  }

  updateUrlHelpForInUse(segment) {
    this.aliasInUse = true;
    this.aliasCheckPending = false;
    this.lastCheckedUrlSegment = segment;
    this.setUrlHelp("This alias is already in use, please use another.", "error");
    this.updateSubmitDisabled();
  }

  updateUrlHelpChecking() {
    this.aliasCheckPending = true;
    this.setUrlHelp("Checking…", "muted");
    this.updateSubmitDisabled();
  }

  scheduleAliasAvailabilityCheck() {
    this.cancelAliasCheckTimer();
    const segment = this.getUrlSegment();

    if (!segment) {
      this.updateUrlHelpForEmpty();
      return;
    }

    this.updateUrlHelpChecking();
    const generation = this.aliasCheckGeneration + 1;
    this.aliasCheckGeneration = generation;

    this.aliasCheckTimer = setTimeout(() => {
      this.aliasCheckTimer = null;
      this.checkAliasAvailability(segment, generation);
    }, ALIAS_CHECK_DEBOUNCE_MS);
  }

  async checkAliasAvailability(segment, generation) {
    const alias = instanceAliasFromSegment(segment);

    try {
      const { available } = await requestJson(
        `/api/genrpg/aliases/availability?alias=${encodeURIComponent(alias)}`,
      );

      if (generation !== this.aliasCheckGeneration) {
        return;
      }

      if (this.getUrlSegment() !== segment) {
        return;
      }

      if (available) {
        this.updateUrlHelpForAvailable(segment);
      } else {
        this.updateUrlHelpForInUse(segment);
      }
    } catch {
      if (generation !== this.aliasCheckGeneration) {
        return;
      }
      this.aliasInUse = false;
      this.aliasCheckPending = false;
      this.setUrlHelp("Could not verify URL availability.", "error");
      this.updateSubmitDisabled();
    }
  }

  onNameInput() {
    const slug = slugifyInstanceUrlSegment(this.elements.$createInstanceNameInput.val());
    this.elements.$createInstanceUrlInput.val(slug);
    this.scheduleAliasAvailabilityCheck();
  }

  onUrlInput() {
    this.scheduleAliasAvailabilityCheck();
  }

  onUrlBlur() {
    let value = this.elements.$createInstanceUrlInput.val();
    if (!isProperlySlugified(value)) {
      value = slugifyInstanceUrlSegment(value);
      this.elements.$createInstanceUrlInput.val(value);
    }
    const segment = slugifyInstanceUrlSegment(value);
    if (segment === this.lastCheckedUrlSegment) {
      return;
    }
    this.scheduleAliasAvailabilityCheck();
  }

  setFormMessage(message, tone = "neutral") {
    setMessage(this.elements.$createInstanceMessage, message, tone);
  }

  resetForm() {
    this.cancelAliasCheckTimer();
    this.aliasCheckGeneration += 1;
    this.aliasInUse = false;
    this.aliasCheckPending = false;
    this.lastCheckedUrlSegment = "";
    this.elements.$createInstanceForm[0].reset();
    renderInstancePackageSelection(this.elements.$createInstancePackageList);
    this.setFormMessage("");
    this.updateUrlHelpForEmpty();
    this.elements.$createInstanceSubmitButton.prop("disabled", false).text("Create Instance");
  }

  open() {
    this.show();
    this.resetForm();
    this.elements.$createInstanceNameInput.trigger("focus");
  }

  onHide() {
    this.resetForm();
  }

  async onSubmit(event) {
    event.preventDefault();
    const formData = new FormData(this.elements.$createInstanceForm[0]);
    const selectedPackages = getSelectedPackages(this.elements.$createInstancePackageList);

    if (!selectedPackages.length) {
      this.setFormMessage("Select at least one package.", "error");
      return;
    }

    if (this.aliasInUse || this.aliasCheckPending) {
      return;
    }

    const urlSegment = this.getUrlSegment();
    const $btn = this.elements.$createInstanceSubmitButton;
    $btn.prop("disabled", true).text("Creating…");

    const body = {
      name: formData.get("name"),
      description: formData.get("description"),
      packages: selectedPackages,
    };
    if (urlSegment) {
      body.url = urlSegment;
    }

    try {
      await requestJson("/api/genrpg/instances", {
        method: "POST",
        body: JSON.stringify(body),
      });
      this.hide();
      setMessage(getElements().$message, "Instance created.", "success");
      await loadApp();
    } catch (error) {
      this.setFormMessage(error.message, "error");
      $btn.prop("disabled", false).text("Create Instance");
      this.updateSubmitDisabled();
    }
  }
}

let createInstanceModal = null;

export function getCreateInstanceModal() {
  if (!createInstanceModal) {
    createInstanceModal = new CreateInstanceModal();
    createInstanceModal.init();
  }
  return createInstanceModal;
}

export function openCreateInstanceModal() {
  getCreateInstanceModal().open();
}
