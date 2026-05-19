import { getElements } from "./elements.js";
import { openManageUsersModal } from "../components/modals/instance-users/instanceUsersModal.js";
import { openManageGlobalUsersModal } from "../components/modals/manage-global-users/manageGlobalUsersModal.js";

export function setupUserEvents() {
  const elements = getElements();

  elements.$instances.on("click", ".manage-users-btn", function () {
    const $btn = $(this);
    openManageUsersModal($btn.data("instance-guid"), $btn.data("instance-name"));
  });

  elements.$manageGlobalUsersButton.on("click", () => openManageGlobalUsersModal());
}
