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

class ManageInstanceModal extends Modal {
  constructor() {
    super("manage-instance-modal", "Create Instance", {
      maxWidth: "36rem",
      width: "92vw",
      enterAnimation: { preset: "scale-down", duration: 200 },
      exitAnimation: { preset: "scale-up", duration: 200 },
      classes: ["manage-instance-modal"],
    });

    this.mode = "create";
    this.editingInstanceGuid = null;
    this.initialUrlSegment = "";
    this.aliasInUse = false;
    this.aliasCheckPending = false;
    this.aliasCheckGeneration = 0;
    this.aliasCheckTimer = null;
    this.lastCheckedUrlSegment = "";
  }

  getContent() {
    this.elements.$instanceMessage = $("<div>", {
      id: "manageInstanceMessage",
      class: "message",
      role: "status",
    });

    this.elements.$instanceNameInput = $("<input>", {
      type: "text",
      name: "name",
      required: true,
      maxlength: 120,
      autocomplete: "off",
    });

    this.elements.$instanceUrlInput = $("<input>", {
      type: "text",
      name: "url",
      maxlength: 120,
      autocomplete: "off",
    });

    this.elements.$instanceUrlHelp = $("<p>", {
      class: "manage-instance-url-help",
      "aria-live": "polite",
    });

    this.elements.$instanceDescriptionInput = $("<textarea>", {
      name: "description",
      rows: 3,
      maxlength: 600,
    });

    this.elements.$instancePackageList = $("<div>", {
      id: "manageInstancePackageList",
      class: "package-list",
      role: "group",
      "aria-label": "Packages",
    });

    this.elements.$instanceSubmitButton = $("<button>", {
      type: "submit",
      class: "primary-button",
      text: "Create Instance",
    });

    this.elements.$instanceForm = $("<form>", {
      id: "manageInstanceForm",
      class: "manage-instance-form",
    }).append(
      $("<label>").append(
        $("<span>", { text: "Name" }),
        this.elements.$instanceNameInput,
      ),
      $("<label>", { class: "manage-instance-url-label" }).append(
        $("<span>", { text: "URL" }),
        this.elements.$instanceUrlInput,
        this.elements.$instanceUrlHelp,
      ),
      $("<label>").append(
        $("<span>", { text: "Description" }),
        this.elements.$instanceDescriptionInput,
      ),
      $("<fieldset>", { class: "manage-instance-packages-fieldset" }).append(
        $("<legend>", { text: "Packages" }),
        this.elements.$instancePackageList,
      ),
      this.elements.$instanceMessage,
      this.elements.$instanceSubmitButton,
    );

    return this.elements.$instanceForm;
  }

  bindEvents() {
    super.bindEvents();
    this.elements.$instanceForm.on("submit", (event) => this.onSubmit(event));
    this.elements.$instanceNameInput.on("input", () => this.onNameInput());
    this.elements.$instanceUrlInput.on("input", () => this.onUrlInput());
    this.elements.$instanceUrlInput.on("blur", () => this.onUrlBlur());
    this.elements.$instancePackageList.on("change", 'input[name="package"]', (event) => {
      if (this.mode === "edit") {
        return;
      }
      const input = event.currentTarget;
      if (input.dataset.machineName === "genrpg") {
        return;
      }
      applyPackageSelectionChange(input.value, input.checked, this.elements.$instancePackageList);
    });
  }

  isEditMode() {
    return this.mode === "edit";
  }

  getSiteBase() {
    return window.location.origin;
  }

  getUrlSegment() {
    return slugifyInstanceUrlSegment(this.elements.$instanceUrlInput.val());
  }

  cancelAliasCheckTimer() {
    if (this.aliasCheckTimer) {
      clearTimeout(this.aliasCheckTimer);
      this.aliasCheckTimer = null;
    }
  }

  updateSubmitDisabled() {
    const disabled = this.aliasInUse || this.aliasCheckPending;
    this.elements.$instanceSubmitButton.prop("disabled", disabled);
  }

  setUrlHelp(message, tone = "neutral") {
    this.elements.$instanceUrlHelp.text(message).attr("data-tone", tone);
  }

  updateUrlHelpForEmpty() {
    this.aliasInUse = false;
    this.aliasCheckPending = false;
    this.lastCheckedUrlSegment = "";
    const hint = this.isEditMode()
      ? "Optional. Clear to use only the auto-generated URL."
      : "Optional. Leave blank for an auto-generated URL.";
    this.setUrlHelp(hint, "neutral");
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
    const params = new URLSearchParams({ alias });
    if (this.editingInstanceGuid) {
      params.set("excludeInstanceGuid", this.editingInstanceGuid);
    }

    try {
      const { available } = await requestJson(
        `/api/genrpg/aliases/availability?${params.toString()}`,
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
    if (this.isEditMode()) {
      return;
    }
    const slug = slugifyInstanceUrlSegment(this.elements.$instanceNameInput.val());
    this.elements.$instanceUrlInput.val(slug);
    this.scheduleAliasAvailabilityCheck();
  }

  onUrlInput() {
    this.scheduleAliasAvailabilityCheck();
  }

  onUrlBlur() {
    let value = this.elements.$instanceUrlInput.val();
    if (!isProperlySlugified(value)) {
      value = slugifyInstanceUrlSegment(value);
      this.elements.$instanceUrlInput.val(value);
    }
    const segment = slugifyInstanceUrlSegment(value);
    if (segment === this.lastCheckedUrlSegment) {
      return;
    }
    this.scheduleAliasAvailabilityCheck();
  }

  setFormMessage(message, tone = "neutral") {
    setMessage(this.elements.$instanceMessage, message, tone);
  }

  setPackagesFieldEnabled(enabled) {
    this.elements.$instancePackageList.find('input[name="package"]').each(function () {
      const isGenrpg = this.dataset.machineName === "genrpg";
      this.disabled = !enabled || isGenrpg;
    });
    this.elements.$instancePackageList.toggleClass("is-readonly", !enabled);
  }

  resetForm() {
    this.cancelAliasCheckTimer();
    this.aliasCheckGeneration += 1;
    this.aliasInUse = false;
    this.aliasCheckPending = false;
    this.lastCheckedUrlSegment = "";
    this.initialUrlSegment = "";
    this.editingInstanceGuid = null;
    this.mode = "create";

    if (!this.elements.$instanceForm?.length) {
      return;
    }

    this.elements.$instanceForm[0].reset();
    renderInstancePackageSelection(this.elements.$instancePackageList);
    this.setPackagesFieldEnabled(true);
    this.setFormMessage("");
    this.updateUrlHelpForEmpty();
    this.setTitle("Create Instance");
    this.elements.$instanceSubmitButton.prop("disabled", false).text("Create Instance");
  }

  openCreate() {
    this.show();
    this.resetForm();
    this.elements.$instanceNameInput.trigger("focus");
  }

  openEdit(instance) {
    this.show();
    this.resetForm();
    this.mode = "edit";
    this.editingInstanceGuid = instance.guid;
    this.initialUrlSegment = instance.url_segment || "";
    this.setTitle("Edit Instance");
    this.elements.$instanceNameInput.val(instance.name || "");
    this.elements.$instanceDescriptionInput.val(instance.description || "");
    this.elements.$instanceUrlInput.val(this.initialUrlSegment);
    renderInstancePackageSelection(this.elements.$instancePackageList, {
      selectedPackages: instance.packageNames || [],
      readOnly: true,
    });
    this.setPackagesFieldEnabled(false);
    this.elements.$instanceSubmitButton.text("Save Changes");
    this.scheduleAliasAvailabilityCheck();
    this.elements.$instanceNameInput.trigger("focus");
  }

  onHide() {
    this.resetForm();
  }

  async onSubmit(event) {
    event.preventDefault();
    const formData = new FormData(this.elements.$instanceForm[0]);

    if (this.aliasInUse || this.aliasCheckPending) {
      return;
    }

    const urlSegment = this.getUrlSegment();
    const $btn = this.elements.$instanceSubmitButton;
    $btn.prop("disabled", true);

    if (this.isEditMode()) {
      $btn.text("Saving…");
      const body = {
        name: formData.get("name"),
        description: formData.get("description"),
        url: urlSegment,
      };

      try {
        await requestJson(`/api/genrpg/instances/${this.editingInstanceGuid}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        this.hide();
        setMessage(getElements().$message, "Instance updated.", "success");
        await loadApp();
      } catch (error) {
        this.setFormMessage(error.message, "error");
        $btn.prop("disabled", false).text("Save Changes");
        this.updateSubmitDisabled();
      }
      return;
    }

    const selectedPackages = getSelectedPackages(this.elements.$instancePackageList);
    if (!selectedPackages.length) {
      this.setFormMessage("Select at least one package.", "error");
      return;
    }

    $btn.text("Creating…");
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

let manageInstanceModal = null;

export function getManageInstanceModal() {
  if (!manageInstanceModal) {
    manageInstanceModal = new ManageInstanceModal();
    manageInstanceModal.init();
  }
  return manageInstanceModal;
}

export function openCreateInstanceModal() {
  getManageInstanceModal().openCreate();
}

export function openEditInstanceModal(instance) {
  getManageInstanceModal().openEdit(instance);
}
