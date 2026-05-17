import { getElements } from "./elements.js";
import { state } from "./state.js";
import { requestJson } from "./api.js";
import { setMessage } from "./utils.js";

function setRoleMessage(message, tone = "neutral") {
  const elements = getElements();
  setMessage(elements.$roleFormMessage, message, tone);
}

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

async function loadPermissions() {
  if (state.allPermissions.length) return state.allPermissions;
  try {
    const data = await requestJson("/api/genrpg/permissions");
    state.allPermissions = data?.permissions || [];
    return state.allPermissions;
  } catch {
    return [];
  }
}

function resetRoleForm() {
  const elements = getElements();
  elements.$roleForm[0].reset();
  elements.$roleFormId.val("");
  elements.$roleFormSubmitButton.text("Create Role");
  elements.$roleFormCancelButton.prop("hidden", true);
  setRoleMessage("");
}

function buildRolesTable(roles) {
  const elements = getElements();
  if (!state.rolesTable) {
    state.rolesTable = new Table({
      id: "roles-table",
      rowCount: { show: true, nounSingular: "role", nounPlural: "roles" },
      searchPlaceholder: "Search roles…",
      defaultSort: { field: "id" },
      columns: [
        { title: "ID", field: "id", sortable: true },
        { title: "Name", field: "name", searchable: true, sortable: true },
        { title: "Description", field: "description", searchable: true, sortable: false },
        {
          title: "Permissions",
          sortable: false,
          renderFunction: (_value, role) => {
            if (!role.permissions || role.permissions.length === 0) return "None";
            return role.permissions.map((p) => p.name).join(", ");
          },
        },
        {
          title: "Actions",
          sortable: false,
          headerClass: "actions-cell",
          cellClass: "actions-cell",
          renderFunction: (_value, role) => {
            const $container = $("<div>", { class: "instance-actions" });
            $container.append(
              $("<button>", {
                type: "button",
                class: "secondary-button edit-role-btn",
                text: "Edit",
              }).attr("data-role", JSON.stringify(role)),
            );
            $container.append(
              $("<button>", {
                type: "button",
                class: "danger-button-outline delete-role-btn",
                text: "Delete",
              }).attr("data-role-id", role.id),
            );
            return $container;
          },
        },
      ],
      emptyState: { message: "No roles found", icon: "" },
    });
    elements.$rolesList.empty().append(state.rolesTable.init());
  }
  state.rolesTable.setData(roles);
}

export async function reloadRolesData() {
  state.allRoles = []; // force reload
  const roles = await loadRoles();
  buildRolesTable(roles);
}

export function setupRoleEvents() {
  const elements = getElements();

  elements.$manageRolesButton.on("click", async function () {
    resetRoleForm();
    const permissions = await loadPermissions();
    
    elements.$rolePermissionsList.empty();
    for (const perm of permissions) {
      const $label = $("<label>");
      const $checkbox = $("<input>", {
        type: "checkbox",
        name: "permissionIds",
        value: perm.id,
      });
      $label.append($checkbox).append($("<span>").text(`${perm.name} — ${perm.description}`));
      elements.$rolePermissionsList.append($label);
    }

    await reloadRolesData();
    elements.$manageRolesModal[0].showModal();
  });

  elements.$closeManageRolesModal.on("click", function () {
    elements.$manageRolesModal[0].close();
  });

  elements.$roleFormCancelButton.on("click", resetRoleForm);

  elements.$roleForm.on("submit", async function (event) {
    event.preventDefault();
    const roleId = elements.$roleFormId.val();
    const isUpdate = !!roleId;
    
    const formData = new FormData(this);
    const payload = {
      name: formData.get("roleName"),
      description: formData.get("roleDescription"),
      permissionIds: formData.getAll("permissionIds").map(Number),
    };

    elements.$roleFormSubmitButton.prop("disabled", true);
    setRoleMessage("Saving...", "neutral");

    try {
      if (isUpdate) {
        await requestJson(`/api/genrpg/roles/${roleId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setRoleMessage("Role updated.", "success");
      } else {
        await requestJson("/api/genrpg/roles", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setRoleMessage("Role created.", "success");
      }
      
      resetRoleForm();
      await reloadRolesData();
    } catch (error) {
      setRoleMessage(error.message, "error");
    } finally {
      elements.$roleFormSubmitButton.prop("disabled", false);
    }
  });

  elements.$rolesList.on("click", ".edit-role-btn", function () {
    const role = $(this).data("role");
    elements.$roleFormId.val(role.id);
    elements.$roleNameInput.val(role.name);
    elements.$roleDescriptionInput.val(role.description);
    
    const rolePermissionIds = (role.permissions || []).map((p) => p.id);
    elements.$roleForm.find("input[name='permissionIds']").each(function () {
      $(this).prop("checked", rolePermissionIds.includes(Number($(this).val())));
    });

    elements.$roleFormSubmitButton.text("Update Role");
    elements.$roleFormCancelButton.prop("hidden", false);
    setRoleMessage("");
    // scroll to form
    elements.$roleForm[0].scrollIntoView({ behavior: "smooth" });
  });

  elements.$rolesList.on("click", ".delete-role-btn", async function () {
    const $btn = $(this);
    const roleId = $btn.data("role-id");
    if (!confirm("Are you sure you want to delete this role?")) return;

    $btn.prop("disabled", true).text("Deleting...");
    try {
      await requestJson(`/api/genrpg/roles/${roleId}`, { method: "DELETE" });
      setRoleMessage("Role deleted.", "success");
      await reloadRolesData();
    } catch (error) {
      $btn.prop("disabled", false).text("Delete");
      setRoleMessage(error.message, "error");
    }
  });
}
