import { getElements } from "../../../js/elements.js";
import { requestJson } from "../../../js/api.js";
import { setMessage } from "../../../js/utils.js";
import { loadApp } from "../../../js/app.js";
import {
  applyPackageSelectionChange,
  getSelectedPackages,
  renderInstancePackageSelection,
} from "../../../js/packages.js";

const Modal = window.Modal;

class CreateInstanceModal extends Modal {
  constructor() {
    super("create-instance-modal", "Create Instance", {
      maxWidth: "36rem",
      width: "92vw",
      enterAnimation: { preset: "scale-down", duration: 200 },
      exitAnimation: { preset: "scale-up", duration: 200 },
      classes: ["create-instance-modal"],
    });
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
    this.elements.$createInstancePackageList.on("change", 'input[name="package"]', (event) => {
      const input = event.currentTarget;
      if (input.dataset.machineName === 'genrpg') {
        return;
      }
      applyPackageSelectionChange(input.value, input.checked, this.elements.$createInstancePackageList);
    });
  }

  setFormMessage(message, tone = "neutral") {
    setMessage(this.elements.$createInstanceMessage, message, tone);
  }

  resetForm() {
    this.elements.$createInstanceForm[0].reset();
    renderInstancePackageSelection(this.elements.$createInstancePackageList);
    this.setFormMessage("");
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

    const $btn = this.elements.$createInstanceSubmitButton;
    $btn.prop("disabled", true).text("Creating…");

    try {
      await requestJson("/api/genrpg/instances", {
        method: "POST",
        body: JSON.stringify({
          name: formData.get("name"),
          description: formData.get("description"),
          packages: selectedPackages,
        }),
      });
      this.hide();
      setMessage(getElements().$message, "Instance created.", "success");
      await loadApp();
    } catch (error) {
      this.setFormMessage(error.message, "error");
      $btn.prop("disabled", false).text("Create Instance");
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
