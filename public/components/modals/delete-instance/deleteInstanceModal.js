import { getElements } from "../../../js/elements.js";
import { requestJson } from "../../../js/api.js";
import { setMessage } from "../../../js/utils.js";
import { loadApp } from "../../../js/app.js";

const Modal = window.Modal;

class DeleteInstanceModal extends Modal {
  constructor() {
    super("delete-instance-modal", "Delete Instance", {
      maxWidth: "52rem",
      width: "92vw",
      enterAnimation: { preset: "scale-down", duration: 200 },
      exitAnimation: { preset: "scale-up", duration: 200 },
      classes: ["delete-instance-modal"],
    });
    this.instanceGuid = null;
    this.instanceName = null;
  }

  getContent() {
    this.elements.$deleteInstanceName = $("<strong>", {
      id: "deleteInstanceName",
      class: "delete-instance-highlight",
    });

    this.elements.$deleteInstanceConfirmInput = $("<input>", {
      type: "text",
      id: "deleteInstanceConfirmInput",
      autocomplete: "off",
      placeholder: "Instance name",
    });

    this.elements.$deleteInstanceMessage = $("<div>", {
      id: "deleteInstanceMessage",
      class: "message",
      role: "status",
    });

    this.elements.$confirmDeleteInstanceButton = $("<button>", {
      type: "button",
      id: "confirmDeleteInstanceButton",
      class: "danger-button",
      text: "Delete Instance",
      disabled: true,
    });

    const $warning = $("<div>", { class: "delete-warning" }).append(
      $("<p>", { class: "delete-warning__icon", text: "⚠️" }),
      $("<p>", { class: "delete-warning__title", text: "This action is irreversible" }),
      $("<p>", { class: "delete-warning__text" }).append(
        "You are about to permanently delete the instance ",
        this.elements.$deleteInstanceName,
        ". All data associated with this instance will be lost.",
      ),
    );

    return $warning
      .add(
        $("<label>").append(
          $("<span>", { text: "Type the instance name to confirm:" }),
          this.elements.$deleteInstanceConfirmInput,
        ),
      )
      .add(this.elements.$deleteInstanceMessage)
      .add(this.elements.$confirmDeleteInstanceButton);
  }

  bindEvents() {
    super.bindEvents();
    this.elements.$deleteInstanceConfirmInput.on("input", () => this.updateConfirmButton());
    this.elements.$confirmDeleteInstanceButton.on("click", () => this.onConfirmDelete());
  }

  setDeleteMessage(message, tone = "neutral") {
    setMessage(this.elements.$deleteInstanceMessage, message, tone);
  }

  updateConfirmButton() {
    const matches = this.elements.$deleteInstanceConfirmInput.val() === this.instanceName;
    this.elements.$confirmDeleteInstanceButton.prop("disabled", !matches);
  }

  show(instanceGuid, instanceName) {
    this.instanceGuid = instanceGuid;
    this.instanceName = instanceName;
    this.createModalElement();
    this.elements.$deleteInstanceName.text(instanceName);
    this.elements.$deleteInstanceConfirmInput.val("");
    this.elements.$confirmDeleteInstanceButton.prop("disabled", true).text("Delete Instance");
    this.setDeleteMessage("");
    this.bindEvents();
    super.show();
    this.elements.$deleteInstanceConfirmInput.trigger("focus");
  }

  onHide() {
    this.instanceGuid = null;
    this.instanceName = null;
  }

  async onConfirmDelete() {
    if (!this.instanceGuid) return;

    const $btn = this.elements.$confirmDeleteInstanceButton;
    $btn.prop("disabled", true).text("Deleting...");

    try {
      await requestJson(`/api/genrpg/instances/${this.instanceGuid}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmName: this.instanceName }),
      });
      this.hide();
      setMessage(getElements().$message, "Instance deleted.", "success");
      await loadApp();
    } catch (error) {
      this.setDeleteMessage(error.message, "error");
      $btn.text("Delete Instance");
      this.updateConfirmButton();
    }
  }
}

let deleteInstanceModal = null;

export function getDeleteInstanceModal() {
  if (!deleteInstanceModal) {
    deleteInstanceModal = new DeleteInstanceModal();
    deleteInstanceModal.init();
  }
  return deleteInstanceModal;
}

export function openDeleteInstanceModal(instanceGuid, instanceName) {
  getDeleteInstanceModal().show(instanceGuid, instanceName);
}
