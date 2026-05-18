import { state } from "../../../js/state.js";
import { requestJson } from "../../../js/api.js";
import { escapeHtml, setMessage } from "../../../js/utils.js";
import { loadRoles } from "../../../js/roles.js";

const Modal = window.Modal;

class InstanceUsersModal extends Modal {
  constructor() {
    super("instance-users-modal", "Manage Users", {
      maxWidth: "52rem",
      width: "92vw",
      enterAnimation: "none",
      exitAnimation: "none",
      classes: ["instance-users-modal"],
    });
    this.instanceGuid = null;
    this.instanceName = null;
    this.instanceUsersTable = null;
  }

  getContent() {
    return `
      <form id="addUserRoleForm" class="add-user-role-form">
        <label>
          <span>User</span>
          <select name="userGuid" id="addUserSelect" required>
            <option value="">Select a user…</option>
          </select>
        </label>
        <label>
          <span>Role</span>
          <select name="roleId" id="addRoleSelect" required>
            <option value="">Select a role…</option>
          </select>
        </label>
        <button type="submit">Assign Role</button>
      </form>
      <div id="addUserMessage" class="message" role="status"></div>
      <hr>
      <h3>Current Users</h3>
      <div id="instanceUsersList"></div>
    `;
  }

  bindEvents() {
    super.bindEvents();
    const $root = this.elements.$root;
    this.elements.$addUserRoleForm = $root.find("#addUserRoleForm");
    this.elements.$addUserSelect = $root.find("#addUserSelect");
    this.elements.$addRoleSelect = $root.find("#addRoleSelect");
    this.elements.$addUserMessage = $root.find("#addUserMessage");
    this.elements.$instanceUsersList = $root.find("#instanceUsersList");

    this.elements.$addUserRoleForm.on("submit", (event) => this.onFormSubmit(event));
    this.elements.$instanceUsersList.on("click", ".remove-user-role-btn", (event) =>
      this.onRemoveUser(event),
    );
  }

  setAddUserMessage(message, tone = "neutral") {
    setMessage(this.elements.$addUserMessage, message, tone);
  }

  buildInstanceUsersTable(users) {
    if (!this.instanceUsersTable) {
      this.instanceUsersTable = new Table({
        id: "instance-users-table",
        data: users,
        rowCount: { show: true, nounSingular: "user", nounPlural: "users" },
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
      this.elements.$instanceUsersList.empty().append(this.instanceUsersTable.init());
      return;
    }
    this.instanceUsersTable.setData(users);
  }

  async loadInstanceUsers() {
    if (!this.instanceGuid) return;
    try {
      const data = await requestJson(`/api/genrpg/instances/${this.instanceGuid}/users`);
      this.buildInstanceUsersTable(data?.users || []);
    } catch (err) {
      this.instanceUsersTable = null;
      this.elements.$instanceUsersList.html(
        `<p class="empty-state">Failed to load users: ${escapeHtml(err.message)}</p>`,
      );
    }
  }

  async populateSelects() {
    const roles = await loadRoles();
    this.elements.$addRoleSelect.html('<option value="">Select a role…</option>');
    for (const role of roles) {
      this.elements.$addRoleSelect.append($("<option>", { value: role.id, text: role.name }));
    }

    try {
      const data = await requestJson("/api/genrpg/users");
      this.elements.$addUserSelect.html('<option value="">Select a user…</option>');
      for (const user of data?.users || []) {
        const label = user.displayName
          ? `${user.displayName} (${user.email || "no email"})`
          : user.email || user.guid;
        this.elements.$addUserSelect.append($("<option>", { value: user.guid, text: label }));
      }
    } catch {
      this.elements.$addUserSelect.html('<option value="">Failed to load users</option>');
    }
  }

  async open(instanceGuid, instanceName) {
    this.instanceGuid = instanceGuid;
    this.instanceName = instanceName;
    state.manageUsersInstanceGuid = instanceGuid;
    state.manageUsersInstanceName = instanceName;

    this.setTitle(`Manage Users — ${instanceName}`);
    this.show();

    this.setAddUserMessage("");
    this.elements.$addUserRoleForm[0].reset();
    await this.populateSelects();
    await this.loadInstanceUsers();
  }

  onHide() {
    this.instanceGuid = null;
    this.instanceName = null;
    state.manageUsersInstanceGuid = null;
    state.manageUsersInstanceName = null;
    this.instanceUsersTable = null;
  }

  async onFormSubmit(event) {
    event.preventDefault();
    if (!this.instanceGuid) return;

    const formData = new FormData(event.currentTarget);
    const userGuid = formData.get("userGuid");
    const roleId = Number(formData.get("roleId"));

    if (!userGuid || !roleId) {
      this.setAddUserMessage("Select a user and a role.", "error");
      return;
    }

    try {
      await requestJson(`/api/genrpg/instances/${this.instanceGuid}/users/${userGuid}`, {
        method: "PUT",
        body: JSON.stringify({ roleId }),
      });
      this.setAddUserMessage("Role assigned.", "success");
      event.currentTarget.reset();
      await this.loadInstanceUsers();
    } catch (error) {
      this.setAddUserMessage(error.message, "error");
    }
  }

  async onRemoveUser(event) {
    if (!this.instanceGuid) return;
    const $btn = $(event.currentTarget);
    const userGuid = $btn.data("user-guid");

    $btn.prop("disabled", true).text("Removing...");

    try {
      await requestJson(`/api/genrpg/instances/${this.instanceGuid}/users/${userGuid}`, {
        method: "DELETE",
      });
      this.setAddUserMessage("User removed.", "success");
      await this.loadInstanceUsers();
    } catch (error) {
      $btn.prop("disabled", false).text("Remove");
      this.setAddUserMessage(error.message, "error");
    }
  }
}

let instanceUsersModal = null;

export function getInstanceUsersModal() {
  if (!instanceUsersModal) {
    instanceUsersModal = new InstanceUsersModal();
    instanceUsersModal.init();
  }
  return instanceUsersModal;
}

export async function openManageUsersModal(instanceGuid, instanceName) {
  await getInstanceUsersModal().open(instanceGuid, instanceName);
}
