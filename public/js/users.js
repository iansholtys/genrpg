import { getElements } from "./elements.js";
import { state } from "./state.js";
import { requestJson } from "./api.js";
import { escapeHtml, setMessage } from "./utils.js";
import { loadRoles } from "./roles.js";

function setAddUserMessage(message, tone = "neutral") {
  const elements = getElements();
  setMessage(elements.$addUserMessage, message, tone);
}

function setGlobalUserMessage(message, tone = "neutral") {
  const elements = getElements();
  setMessage(elements.$globalUsersMessage, message, tone);
}

function buildInstanceUsersTable(users) {
  const elements = getElements();
  state.instanceUsersTable = new Table({
    id: "instance-users-table",
    rowCount: {
      show: true,
      nounSingular: "user",
      nounPlural: "users",
    },
    searchPlaceholder: "Search users…",
    defaultSort: { field: "displayName" },
    columns: [
      { title: "Name", field: "displayName", searchable: true },
      { title: "Email", field: "email", searchable: true },
      { title: "Role", field: "roleName" },
      {
        title: "Actions",
        sortable: false,
        headerClass: "actions-cell",
        cellClass: "actions-cell",
        renderFunction: (_value, user) =>
          $("<button>", {
            type: "button",
            class: "danger-button-outline remove-user-role-btn",
            text: "Remove",
          }).attr("data-user-guid", user.guid),
      },
    ],
    emptyState: {
      message: "No users assigned",
      icon: "",
      detailNoData: "No users have been assigned to this instance yet.",
      detailFiltered: "No users match your search.",
    },
  });

  elements.$instanceUsersList.empty().append(state.instanceUsersTable.init());
  state.instanceUsersTable.setData(users);
}

async function loadInstanceUsers() {
  const elements = getElements();
  if (!state.manageUsersInstanceGuid) return;
  try {
    const data = await requestJson(`/api/genrpg/instances/${state.manageUsersInstanceGuid}/users`);
    buildInstanceUsersTable(data?.users || []);
  } catch (err) {
    elements.$instanceUsersList.html(
      `<p class="empty-state">Failed to load users: ${escapeHtml(err.message)}</p>`,
    );
  }
}

async function openManageUsersModal(instanceGuid, instanceName) {
  const elements = getElements();
  state.manageUsersInstanceGuid = instanceGuid;
  state.manageUsersInstanceName = instanceName;
  elements.$manageUsersInstanceName.text(instanceName);
  setAddUserMessage("");
  elements.$addUserRoleForm[0].reset();

  // Populate role select
  const roles = await loadRoles();
  elements.$addRoleSelect.html('<option value="">Select a role…</option>');
  for (const role of roles) {
    elements.$addRoleSelect.append(
      $("<option>", { value: role.id, text: role.name }),
    );
  }

  // Populate user select
  try {
    const data = await requestJson("/api/genrpg/users");
    elements.$addUserSelect.html('<option value="">Select a user…</option>');
    for (const user of data?.users || []) {
      const label = user.displayName
        ? `${user.displayName} (${user.email || "no email"})`
        : user.email || user.guid;
      elements.$addUserSelect.append(
        $("<option>", { value: user.guid, text: label }),
      );
    }
  } catch {
    elements.$addUserSelect.html('<option value="">Failed to load users</option>');
  }

  await loadInstanceUsers();
  elements.$manageUsersModal[0].showModal();
}

function buildGlobalUsersTable(users) {
  const elements = getElements();
  if (!state.globalUsersTable) {
    state.globalUsersTable = new Table({
      id: "global-users-table",
      rowCount: { show: true, nounSingular: "user", nounPlural: "users" },
      searchPlaceholder: "Search users…",
      defaultSort: { field: "displayName" },
      columns: [
        { title: "Name", field: "displayName", searchable: true, sortable: true },
        { title: "Email", field: "email", searchable: true, sortable: true },
        {
          title: "Is Admin",
          field: "admin",
          sortable: true,
          renderFunction: (val) => val ? "Yes" : "No",
        },
        {
          title: "Actions",
          sortable: false,
          headerClass: "actions-cell",
          cellClass: "actions-cell",
          renderFunction: (_value, user) => {
            const $container = $("<div>", { class: "instance-actions" });
            
            // Only allow actions if not the current user
            if (state.currentUser && user.guid !== state.currentUser.guid) {
              const promoteBtnText = user.admin ? "Demote" : "Promote";
              $container.append(
                $("<button>", {
                  type: "button",
                  class: "secondary-button toggle-admin-btn",
                  text: promoteBtnText,
                })
                  .attr("data-user-guid", user.guid)
                  .attr("data-is-admin", user.admin ? "true" : "false"),
              );

              $container.append(
                $("<button>", {
                  type: "button",
                  class: "danger-button-outline delete-global-user-btn",
                  text: "Delete",
                }).attr("data-user-guid", user.guid),
              );
            } else {
              $container.text("(You)");
            }
            return $container;
          },
        },
      ],
      emptyState: { message: "No users found", icon: "" },
    });
    elements.$globalUsersList.empty().append(state.globalUsersTable.init());
  }
  state.globalUsersTable.setData(users);
}

export async function loadGlobalUsers() {
  try {
    const data = await requestJson("/api/genrpg/users");
    buildGlobalUsersTable(data?.users || []);
  } catch (error) {
    setGlobalUserMessage(error.message, "error");
  }
}

export function setupUserEvents() {
  const elements = getElements();

  elements.$instances.on("click", ".manage-users-btn", function () {
    const $btn = $(this);
    openManageUsersModal($btn.data("instance-guid"), $btn.data("instance-name"));
  });

  elements.$closeManageUsersModal.on("click", function () {
    elements.$manageUsersModal[0].close();
    state.manageUsersInstanceGuid = null;
    state.manageUsersInstanceName = null;
  });

  elements.$addUserRoleForm.on("submit", async function (event) {
    event.preventDefault();
    if (!state.manageUsersInstanceGuid) return;

    const formData = new FormData(this);
    const userGuid = formData.get("userGuid");
    const roleId = Number(formData.get("roleId"));

    if (!userGuid || !roleId) {
      setAddUserMessage("Select a user and a role.", "error");
      return;
    }

    try {
      await requestJson(`/api/genrpg/instances/${state.manageUsersInstanceGuid}/users/${userGuid}`, {
        method: "PUT",
        body: JSON.stringify({ roleId }),
      });
      setAddUserMessage("Role assigned.", "success");
      this.reset();
      await loadInstanceUsers();
    } catch (error) {
      setAddUserMessage(error.message, "error");
    }
  });

  elements.$instanceUsersList.on("click", ".remove-user-role-btn", async function () {
    if (!state.manageUsersInstanceGuid) return;
    const $btn = $(this);
    const userGuid = $btn.data("user-guid");

    $btn.prop("disabled", true).text("Removing...");

    try {
      await requestJson(`/api/genrpg/instances/${state.manageUsersInstanceGuid}/users/${userGuid}`, {
        method: "DELETE",
      });
      setAddUserMessage("User removed.", "success");
      await loadInstanceUsers();
    } catch (error) {
      $btn.prop("disabled", false).text("Remove");
      setAddUserMessage(error.message, "error");
    }
  });

  elements.$manageGlobalUsersButton.on("click", async function () {
    setGlobalUserMessage("");
    await loadGlobalUsers();
    elements.$manageGlobalUsersModal[0].showModal();
  });

  elements.$closeManageGlobalUsersModal.on("click", function () {
    elements.$manageGlobalUsersModal[0].close();
  });

  elements.$globalUsersList.on("click", ".toggle-admin-btn", async function () {
    const $btn = $(this);
    const userGuid = $btn.data("user-guid");
    const currentlyAdmin = $btn.data("is-admin") === true || $btn.data("is-admin") === "true";
    const newAdminState = !currentlyAdmin;

    $btn.prop("disabled", true).text("Updating...");
    try {
      await requestJson(`/api/genrpg/users/${userGuid}/admin`, {
        method: "PUT",
        body: JSON.stringify({ admin: newAdminState }),
      });
      setGlobalUserMessage(`User ${newAdminState ? "promoted to admin" : "demoted to regular user"}.`, "success");
      await loadGlobalUsers();
    } catch (error) {
      $btn.prop("disabled", false).text(currentlyAdmin ? "Demote" : "Promote");
      setGlobalUserMessage(error.message, "error");
    }
  });

  elements.$globalUsersList.on("click", ".delete-global-user-btn", async function () {
    const $btn = $(this);
    const userGuid = $btn.data("user-guid");
    if (!confirm("Are you sure you want to permanently delete this user? This will also remove them from all instances.")) return;

    $btn.prop("disabled", true).text("Deleting...");
    try {
      await requestJson(`/api/genrpg/users/${userGuid}`, { method: "DELETE" });
      setGlobalUserMessage("User deleted successfully.", "success");
      await loadGlobalUsers();
    } catch (error) {
      $btn.prop("disabled", false).text("Delete");
      setGlobalUserMessage(error.message, "error");
    }
  });
}
