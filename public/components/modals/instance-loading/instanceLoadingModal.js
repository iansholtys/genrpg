const Modal = window.Modal;

export class InstanceLoadingModal extends Modal {
  /**
   * @param {JQuery} $panel Loading UI root.
   */
  constructor($panel) {
    super("instance-loading-modal", "", {
      closeOnEscape: false,
      closeOnOutsideClick: false,
      classes: ["instance-loading-modal"],
      maxWidth: "28rem",
      width: "92vw",
      enterAnimation: { preset: "scale-down", scale: 1.1 },
      exitAnimation: { preset: "scale-down", scale: 1.1 },
    });
    this.$panel = $panel;
  }

  getContent() {
    return this.$panel;
  }
}
