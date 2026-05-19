import { getElements } from "./elements.js";
import { openManageGlobalUsersModal } from "../components/modals/manage-global-users/manageGlobalUsersModal.js";

export function setupUserEvents() {
  const elements = getElements();
  elements.$manageGlobalUsersButton.on("click", () => openManageGlobalUsersModal());
}
