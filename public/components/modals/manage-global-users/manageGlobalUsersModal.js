import { state } from "../../../js/state.js";
import { requestJson } from "../../../js/api.js";
import { setMessage } from "../../../js/utils.js";

const Modal = window.Modal;

class ManageGlobalUsersModal extends Modal {
  constructor() {
    super("manage-global-users-modal", "Manage Users", {
      maxWidth: "52rem",
      width: "92vw",
      enterAnimation: { preset: "scale-down", duration: 200 },
      exitAnimation: { preset: "scale-up", duration: 200 },
      classes: ["manage-global-users-modal"],
    });
    this.globalUsersTable = null;
  }

  getContent() {
    this.elements.$globalUsersMessage = $("<div>", {
      id: "globalUsersMessage",
      class: "message",
      role: "status",
    });

    this.elements.$globalUsersList = $("<div>", { id: "globalUsersList" });

    return this.elements.$globalUsersMessage.add(this.elements.$globalUsersList);
  }

  bindEvents() {
    super.bindEvents();
    this.elements.$globalUsersList.on("click", ".toggle-admin-btn", (event) =>
      this.onToggleAdmin(event),
    );
    this.elements.$globalUsersList.on("click", ".delete-global-user-btn", (event) =>
      this.onDeleteUser(event),
    );
  }

  setGlobalUserMessage(message, tone = "neutral") {
    setMessage(this.elements.$globalUsersMessage, message, tone);
  }

  buildGlobalUsersTable(users) {
    if (!this.globalUsersTable) {
      this.globalUsersTable = new Table({
        id: "global-users-table",
        data: users,
        rowCount: { show: true, nounSingular: "user", nounPlural: "users" },
        searchPlaceholder: "Search users…",
        defaultSort: { field: "displayName" },
        columns: [
          { title: "Name", field: "displayName", searchable: true },
          { title: "Email", searchable: true },
          {
            title: "Admin",
            valueFunction: (_user, value) => (value ? "Yes" : "No"),
          },
          {
            title: "Actions",
            sortable: false,
            headerClass: "actions-cell",
            cellClass: "actions-cell",
            renderFunction: (_value, user) => {
              const $container = $("<div>", { class: "instance-actions" });

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
      this.elements.$globalUsersList.empty().append(this.globalUsersTable.init());
      return;
    }
    this.globalUsersTable.setData(users);
  }

  async loadGlobalUsers() {
    try {
      const data = await requestJson("/api/genrpg/users");
      this.buildGlobalUsersTable(data?.users || []);
    } catch (error) {
      this.setGlobalUserMessage(error.message, "error");
    }
  }

  async show() {
    this.createModalElement();
    this.setGlobalUserMessage("");
    this.bindEvents();
    super.show();
    await this.loadGlobalUsers();
  }

  onHide() {
    this.globalUsersTable = null;
  }

  async onToggleAdmin(event) {
    const $btn = $(event.currentTarget);
    const userGuid = $btn.data("user-guid");
    const currentlyAdmin = $btn.data("is-admin") === true || $btn.data("is-admin") === "true";
    const newAdminState = !currentlyAdmin;

    $btn.prop("disabled", true).text("Updating...");
    try {
      await requestJson(`/api/genrpg/users/${userGuid}/admin`, {
        method: "PUT",
        body: JSON.stringify({ admin: newAdminState }),
      });
      this.setGlobalUserMessage(
        `User ${newAdminState ? "promoted to admin" : "demoted to regular user"}.`,
        "success",
      );
      await this.loadGlobalUsers();
    } catch (error) {
      $btn.prop("disabled", false).text(currentlyAdmin ? "Demote" : "Promote");
      this.setGlobalUserMessage(error.message, "error");
    }
  }

  async onDeleteUser(event) {
    const $btn = $(event.currentTarget);
    const userGuid = $btn.data("user-guid");
    if (
      !confirm(
        "Are you sure you want to permanently delete this user? This will also remove them from all instances.",
      )
    ) {
      return;
    }

    $btn.prop("disabled", true).text("Deleting...");
    try {
      await requestJson(`/api/genrpg/users/${userGuid}`, { method: "DELETE" });
      this.setGlobalUserMessage("User deleted successfully.", "success");
      await this.loadGlobalUsers();
    } catch (error) {
      $btn.prop("disabled", false).text("Delete");
      this.setGlobalUserMessage(error.message, "error");
    }
  }
}

let manageGlobalUsersModal = null;

export function getManageGlobalUsersModal() {
  if (!manageGlobalUsersModal) {
    manageGlobalUsersModal = new ManageGlobalUsersModal();
    manageGlobalUsersModal.init();
  }
  return manageGlobalUsersModal;
}

export async function openManageGlobalUsersModal() {
  await getManageGlobalUsersModal().show();
}
