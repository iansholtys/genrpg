import { state } from "../../../js/state.js";
import { requestJson } from "../../../js/api.js";
import { notify } from "../../../js/utils.js";
import { loadRoles } from "../../../js/roles.js";

const Modal = window.Modal;

class ManageRolesModal extends Modal {
  constructor() {
    super("manage-roles-modal", "Manage Roles", {
      maxWidth: "52rem",
      width: "92vw",
      enterAnimation: { preset: "scale-down", duration: 200 },
      exitAnimation: { preset: "scale-up", duration: 200 },
      classes: ["manage-roles-modal"],
    });
    this.rolesTable = null;
    this.allPermissions = [];
  }

  getContent() {
    this.elements.$roleFormId = $("<input>", {
      type: "hidden",
      id: "roleFormId",
      name: "roleGuid",
      value: "",
    });

    this.elements.$roleNameInput = $("<input>", {
      type: "text",
      name: "roleName",
      id: "roleNameInput",
      required: true,
      maxlength: 80,
      autocomplete: "off",
      placeholder: "e.g. Instance_Moderator",
    });

    this.elements.$roleDescriptionInput = $("<input>", {
      type: "text",
      name: "roleDescription",
      id: "roleDescriptionInput",
      maxlength: 200,
      autocomplete: "off",
      placeholder: "Brief description of this role",
    });

    this.elements.$rolePermissionsList = $("<div>", {
      id: "rolePermissionsList",
      class: "role-permissions-list",
    });

    this.elements.$roleFormSubmitButton = $("<button>", {
      type: "submit",
      id: "roleFormSubmitButton",
      text: "Create Role",
    });

    this.elements.$roleFormCancelButton = $("<button>", {
      type: "button",
      id: "roleFormCancelButton",
      class: "secondary-button",
      text: "Cancel",
      hidden: true,
    });

    this.elements.$roleForm = $("<form>", { id: "roleForm", class: "role-form" }).append(
      this.elements.$roleFormId,
      $("<label>").append(
        $("<span>", { text: "Role Name" }),
        this.elements.$roleNameInput,
      ),
      $("<label>").append(
        $("<span>", { text: "Description" }),
        this.elements.$roleDescriptionInput,
      ),
      $("<fieldset>", { id: "rolePermissionsFieldset", class: "role-permissions-fieldset" }).append(
        $("<legend>", { text: "Permissions" }),
        this.elements.$rolePermissionsList,
      ),
      $("<div>", { class: "role-form-actions" }).append(
        this.elements.$roleFormSubmitButton,
        this.elements.$roleFormCancelButton,
      ),
    );

    this.elements.$rolesList = $("<div>", { id: "rolesList" });

    return this.elements.$roleForm
      .add($("<hr>"))
      .add($("<h3>", { text: "Existing Roles" }))
      .add(this.elements.$rolesList);
  }

  bindEvents() {
    super.bindEvents();
    this.elements.$roleForm.on("submit", (event) => this.onFormSubmit(event));
    this.elements.$roleFormCancelButton.on("click", () => this.resetRoleForm());
    this.elements.$rolesList.on("click", ".edit-role-btn", (event) => this.onEditRole(event));
    this.elements.$rolesList.on("click", ".delete-role-btn", (event) => this.onDeleteRole(event));
  }

  resetRoleForm() {
    this.elements.$roleForm[0].reset();
    this.elements.$roleFormId.val("");
    this.elements.$roleFormSubmitButton.text("Create Role");
    this.elements.$roleFormCancelButton.prop("hidden", true);
  }

  async loadPermissions() {
    if (this.allPermissions.length) return this.allPermissions;
    try {
      const data = await requestJson("/api/genrpg/permissions");
      this.allPermissions = data?.permissions || [];
      return this.allPermissions;
    } catch {
      return [];
    }
  }

  populatePermissionCheckboxes(permissions) {
    this.elements.$rolePermissionsList.empty();
    for (const perm of permissions) {
      const $label = $("<label>");
      const $checkbox = $("<input>", {
        type: "checkbox",
        name: "permissionGuids",
        value: perm.guid,
      });
      $label.append($checkbox).append($("<span>").text(`${perm.name} — ${perm.description}`));
      this.elements.$rolePermissionsList.append($label);
    }
  }

  buildRolesTable(roles) {
    if (!this.rolesTable) {
      this.rolesTable = new Table({
        id: "roles-table",
        data: roles,
        rowCount: { show: true, noun: "role" },
        searchPlaceholder: "Search roles…",
        defaultSort: { field: "name" },
        columns: [
          { title: "Name", searchable: true },
          { title: "Description", searchable: true, sortable: false },
          {
            title: "Permissions",
            sortable: false,
            renderFunction: (_value, role) => {
              if (!role.permissions?.length) return "None";
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
                }).attr("data-role-id", role.guid),
              );
              return $container;
            },
          },
        ],
        emptyState: { message: "No roles found", icon: "" },
      });
      this.elements.$rolesList.empty().append(this.rolesTable.init());
      return;
    }
    this.rolesTable.setData(roles);
  }

  async reloadRolesData() {
    state.allRoles = [];
    const roles = await loadRoles();
    this.buildRolesTable(roles);
  }

  async show() {
    this.createModalElement();
    this.resetRoleForm();
    this.bindEvents();
    super.show();
    const permissions = await this.loadPermissions();
    this.populatePermissionCheckboxes(permissions);
    await this.reloadRolesData();
  }

  onHide() {
    this.rolesTable = null;
  }

  async onFormSubmit(event) {
    event.preventDefault();
    const roleGuid = this.elements.$roleFormId.val();
    const isUpdate = !!roleGuid;

    const formData = new FormData(event.currentTarget);
    const payload = {
      name: formData.get("roleName"),
      description: formData.get("roleDescription"),
      permissionGuids: formData.getAll("permissionGuids"),
    };

    this.elements.$roleFormSubmitButton.prop("disabled", true);

    try {
      if (isUpdate) {
        await requestJson(`/api/genrpg/roles/${roleGuid}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        notify("Role updated.", "success");
      } else {
        await requestJson("/api/genrpg/roles", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        notify("Role created.", "success");
      }

      this.resetRoleForm();
      await this.reloadRolesData();
    } catch (error) {
      notify(error.message, "error");
    } finally {
      this.elements.$roleFormSubmitButton.prop("disabled", false);
    }
  }

  onEditRole(event) {
    const role = $(event.currentTarget).data("role");
    this.elements.$roleFormId.val(role.guid);
    this.elements.$roleNameInput.val(role.name);
    this.elements.$roleDescriptionInput.val(role.description);

    const rolePermissionGuids = (role.permissions || []).map((p) => p.guid);
    this.elements.$roleForm.find("input[name='permissionGuids']").each(function () {
      $(this).prop("checked", rolePermissionGuids.includes($(this).val()));
    });

    this.elements.$roleFormSubmitButton.text("Update Role");
    this.elements.$roleFormCancelButton.prop("hidden", false);
    this.elements.$roleForm[0].scrollIntoView({ behavior: "smooth" });
  }

  async onDeleteRole(event) {
    const $btn = $(event.currentTarget);
    const roleGuid = $btn.data("role-id");
    if (!confirm("Are you sure you want to delete this role?")) return;

    $btn.prop("disabled", true).text("Deleting...");
    try {
      await requestJson(`/api/genrpg/roles/${roleGuid}`, { method: "DELETE" });
      notify("Role deleted.", "success");
      await this.reloadRolesData();
    } catch (error) {
      $btn.prop("disabled", false).text("Delete");
      notify(error.message, "error");
    }
  }
}

let manageRolesModal = null;

function getManageRolesModal() {
  if (!manageRolesModal) {
    manageRolesModal = new ManageRolesModal();
    manageRolesModal.init();
  }
  return manageRolesModal;
}

export async function openManageRolesModal() {
  await getManageRolesModal().show();
}
