import { getElements } from "./elements.js";
import { state } from "./state.js";
import { requestJson } from "./api.js";
import { openManageRolesModal } from "../components/modals/manage-roles/manageRolesModal.js";

export async function loadRoles() {
  if (state.allRoles.length) return state.allRoles;
  try {
    const data = await requestJson("/api/genrpg/roles");
    state.allRoles = data?.roles || [];
    return state.allRoles;
  } catch {
    return [];
  }
}

export function setupRoleEvents() {
  const elements = getElements();
  elements.$manageRolesButton.on("click", () => openManageRolesModal());
}
