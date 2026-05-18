import { getElements } from "./elements.js";
import { state } from "./state.js";
import { requestJson } from "./api.js";
import { setMessage } from "./utils.js";
import { openManageUsersModal } from "../components/modals/instance-users/instanceUsersModal.js";

function setGlobalUserMessage(message, tone = "neutral") {
  const elements = getElements();
  setMessage(elements.$globalUsersMessage, message, tone);
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
