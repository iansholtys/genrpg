import { getElements } from "../../../js/elements.js";
import { requestJson } from "../../../js/api.js";
import { escapeHtml, setMessage } from "../../../js/utils.js";
import { loadApp } from "../../../js/app.js";
import { loadRoles } from "../../../js/roles.js";
import {
  applyPackageSelectionChange,
  getSelectedPackages,
  renderInstancePackageSelection,
} from "../../../js/packages.js";
import {
  slugifyInstanceUrlSegment,
  isProperlySlugified,
  instanceAliasFromSegment,
} from "../../../js/slug.js";

const { Modal, TabbedRegion } = window;
const ALIAS_CHECK_DEBOUNCE_MS = 300;

class ManageInstanceModal extends Modal {
  constructor() {
    super("manage-instance-modal", "Create Instance", {
      maxWidth: "36rem",
      width: "92vw",
      enterAnimation: { preset: "scale-down", duration: 200 },
      exitAnimation: { preset: "scale-up", duration: 200 },
      classes: ["manage-instance-modal"],
    });

    this.instance = null;
    this.usersTabLoaded = false;
    this.instanceUsersTable = null;
    this.aliasInUse = false;
    this.aliasCheckPending = false;
    this.aliasCheckGeneration = 0;
    this.aliasCheckTimer = null;
    this.lastCheckedUrlSegment = "";
    this.tabbedRegion = null;
  }

  getContent() {
    this.elements.$bodyHost = $('<div>', { class: 'manage-instance-body' });
    return this.elements.$bodyHost;
  }

  renderCreateBody() {
    this.destroyTabbedRegion();
    this.elements.$bodyHost.empty();
    this.elements.$bodyHost.append(this.buildEditPanel());
  }

  renderManageBody(instance) {
    this.destroyTabbedRegion();
    this.elements.$bodyHost.empty();

    this.tabbedRegion = new TabbedRegion({
      id: "manage-instance-tabs",
      ariaLabel: "Instance management",
      onTabChange: ({ tab }) => void this.onTabChange(tab.id),
    });

    if (instance.can_edit) {
      this.tabbedRegion.addTab("edit", "Edit", this.buildEditPanel());
    }
    if (instance.can_manage_users) {
      this.tabbedRegion.addTab("users", "Users", this.buildUsersPanel());
    }
    if (instance.can_delete) {
      this.tabbedRegion.addTab("delete", "Delete", this.buildDeletePanel());
    }

    this.elements.$tabbedRegion = this.tabbedRegion.init();
    this.elements.$bodyHost.append(this.elements.$tabbedRegion);
  }

  destroyTabbedRegion() {
    this.tabbedRegion?.destroy();
    this.tabbedRegion = null;
    this.elements.$tabbedRegion = null;
  }

  buildEditPanel() {
    this.elements.$instanceMessage = $("<div>", {
      id: "manageInstanceMessage",
      class: "message",
      role: "status",
    });

    this.elements.$instanceNameInput = $("<input>", {
      type: "text",
      name: "instanceName",
      id: "instanceNameInput",
      required: true,
      maxlength: 120,
      autocomplete: "off",
    });

    this.elements.$instanceUrlInput = $("<input>", {
      type: "text",
      name: "url",
      maxlength: 120,
      autocomplete: "off",
    });

    this.elements.$instanceUrlHelp = $("<p>", {
      class: "manage-instance-url-help",
      "aria-live": "polite",
    });

    this.elements.$instanceDescriptionInput = $("<textarea>", {
      name: "description",
      rows: 3,
      maxlength: 600,
    });

    this.elements.$instancePackageList = $("<div>", {
      id: "manageInstancePackageList",
      class: "package-list",
      role: "group",
      "aria-label": "Packages",
    });

    this.elements.$instanceSubmitButton = $("<button>", {
      type: "submit",
      class: "primary-button",
      text: "Create Instance",
    });

    this.elements.$instanceForm = $("<form>", {
      id: "manageInstanceForm",
      class: "manage-instance-form",
    }).append(
      $("<label>").append(
        $("<span>", { text: "Instance name" }),
        this.elements.$instanceNameInput,
      ),
      $("<label>", { class: "manage-instance-url-label" }).append(
        $("<span>", { text: "URL" }),
        this.elements.$instanceUrlInput,
        this.elements.$instanceUrlHelp,
      ),
      $("<label>").append(
        $("<span>", { text: "Description" }),
        this.elements.$instanceDescriptionInput,
      ),
      $("<fieldset>", { class: "manage-instance-packages-fieldset" }).append(
        $("<legend>", { text: "Packages" }),
        this.elements.$instancePackageList,
      ),
      this.elements.$instanceMessage,
      this.elements.$instanceSubmitButton,
    );

    return this.elements.$instanceForm;
  }

  buildUsersPanel() {
    this.elements.$addUserSelect = $("<select>", {
      name: "userGuid",
      id: "addUserSelect",
      required: true,
    }).append($("<option>", { value: "", text: "Select a user…" }));

    this.elements.$addRoleSelect = $("<select>", {
      name: "roleId",
      id: "addRoleSelect",
      required: true,
    }).append($("<option>", { value: "", text: "Select a role…" }));

    this.elements.$addUserRoleForm = $("<form>", {
      id: "addUserRoleForm",
      class: "add-user-role-form",
    }).append(
      $("<label>").append(
        $("<span>", { text: "User" }),
        this.elements.$addUserSelect,
      ),
      $("<label>").append(
        $("<span>", { text: "Role" }),
        this.elements.$addRoleSelect,
      ),
      $("<button>", { type: "submit", text: "Assign Role" }),
    );

    this.elements.$addUserMessage = $("<div>", {
      id: "addUserMessage",
      class: "message",
      role: "status",
    });

    this.elements.$instanceUsersList = $("<div>", { id: "instanceUsersList" });

    return this.elements.$addUserRoleForm
      .add(this.elements.$addUserMessage)
      .add($("<hr>"))
      .add($("<h3>", { text: "Current Users" }))
      .add(this.elements.$instanceUsersList);
  }

  buildDeletePanel() {
    this.elements.$deleteInstanceName = $("<strong>", {
      id: "deleteInstanceName",
      class: "delete-instance-highlight",
    });

    this.elements.$deleteInstanceConfirmInput = $("<input>", {
      type: "text",
      id: "deleteInstanceConfirmInput",
      autocomplete: "off",
      placeholder: "Instance name",
    });

    this.elements.$deleteInstanceMessage = $("<div>", {
      id: "deleteInstanceMessage",
      class: "message",
      role: "status",
    });

    this.elements.$confirmDeleteInstanceButton = $("<button>", {
      type: "button",
      id: "confirmDeleteInstanceButton",
      class: "danger-button",
      text: "Delete Instance",
      disabled: true,
    });

    const $warning = $("<div>", { class: "delete-warning" }).append(
      $("<p>", { class: "delete-warning__icon", text: "⚠️" }),
      $("<p>", { class: "delete-warning__title", text: "This action is irreversible" }),
      $("<p>", { class: "delete-warning__text" }).append(
        "You are about to permanently delete the instance ",
        this.elements.$deleteInstanceName,
        ". All data associated with this instance will be lost.",
      ),
    );

    return $warning
      .add(
        $("<label>").append(
          $("<span>", { text: "Type the instance name to confirm:" }),
          this.elements.$deleteInstanceConfirmInput,
        ),
      )
      .add(this.elements.$deleteInstanceMessage)
      .add(this.elements.$confirmDeleteInstanceButton);
  }

  bindEvents() {
    super.bindEvents();
    this.elements.$instanceForm?.on("submit", (event) => this.onSubmit(event));
    this.elements.$instanceNameInput?.on("input", () => this.onNameInput());
    this.elements.$instanceUrlInput?.on("input", () => this.scheduleAliasAvailabilityCheck());
    this.elements.$instanceUrlInput?.on("blur", () => this.onUrlBlur());
    this.elements.$instancePackageList?.on("change", 'input[name="package"]', (event) => {
      if (this.isManageMode()) {
        return;
      }
      const input = event.currentTarget;
      if (input.dataset.machineName === "genrpg") {
        return;
      }
      applyPackageSelectionChange(input.value, input.checked, this.elements.$instancePackageList);
    });
    this.elements.$addUserRoleForm?.on("submit", (event) => this.onUsersFormSubmit(event));
    this.elements.$instanceUsersList?.on("click", ".remove-user-role-btn", (event) =>
      this.onRemoveUser(event),
    );
    this.elements.$deleteInstanceConfirmInput?.on("input", () => this.updateConfirmButton());
    this.elements.$confirmDeleteInstanceButton?.on("click", () => this.onConfirmDelete());
  }

  isManageMode() {
    return this.instance != null;
  }

  isCreateMode() {
    return this.instance == null;
  }

  setModalLayout() {
    const isManage = this.isManageMode();
    this.elements.$root.toggleClass("manage-instance-modal--manage", isManage);
    this.elements.$root.toggleClass("manage-instance-modal--create", !isManage);
    this.elements.$content.css("max-width", isManage ? "52rem" : "36rem");
  }

  async onTabChange(tabId) {
    if (!this.isManageMode()) {
      return;
    }

    switch (tabId) {
      case "users":
        if (!this.usersTabLoaded) {
          await this.populateUserSelects();
          await this.loadInstanceUsers();
          this.usersTabLoaded = true;
        }
        break;
      case "delete":
        this.elements.$deleteInstanceConfirmInput?.trigger("focus");
        break;
      case "edit":
        this.elements.$instanceNameInput?.trigger("focus");
        break;
    }
  }

  getUrlSegment() {
    return slugifyInstanceUrlSegment(this.elements.$instanceUrlInput.val());
  }

  cancelAliasCheckTimer() {
    if (this.aliasCheckTimer) {
      clearTimeout(this.aliasCheckTimer);
      this.aliasCheckTimer = null;
    }
  }

  updateSubmitDisabled() {
    const disabled = this.aliasInUse || this.aliasCheckPending;
    this.elements.$instanceSubmitButton.prop("disabled", disabled);
  }

  setUrlHelp(message, tone = "neutral") {
    this.elements.$instanceUrlHelp.text(message).attr("data-tone", tone);
  }

  updateUrlHelpForEmpty() {
    this.aliasInUse = false;
    this.aliasCheckPending = false;
    this.lastCheckedUrlSegment = "";
    const hint = this.isManageMode()
      ? "Optional. Clear to use only the auto-generated URL."
      : "Optional. Leave blank for an auto-generated URL.";
    this.setUrlHelp(hint, "neutral");
    this.updateSubmitDisabled();
  }

  updateUrlHelpForAvailable(segment) {
    this.aliasInUse = false;
    this.aliasCheckPending = false;
    this.lastCheckedUrlSegment = segment;
    const base = window.location.origin;
    this.setUrlHelp(`Your instance will be at ${base}/instance/${segment}`, "neutral");
    this.updateSubmitDisabled();
  }

  updateUrlHelpForInUse(segment) {
    this.aliasInUse = true;
    this.aliasCheckPending = false;
    this.lastCheckedUrlSegment = segment;
    this.setUrlHelp("This alias is already in use, please use another.", "error");
    this.updateSubmitDisabled();
  }

  updateUrlHelpChecking() {
    this.aliasCheckPending = true;
    this.setUrlHelp("Checking…", "muted");
    this.updateSubmitDisabled();
  }

  scheduleAliasAvailabilityCheck() {
    this.cancelAliasCheckTimer();
    const segment = this.getUrlSegment();

    if (!segment) {
      this.updateUrlHelpForEmpty();
      return;
    }

    this.updateUrlHelpChecking();
    const generation = this.aliasCheckGeneration + 1;
    this.aliasCheckGeneration = generation;

    this.aliasCheckTimer = setTimeout(() => {
      this.aliasCheckTimer = null;
      this.checkAliasAvailability(segment, generation);
    }, ALIAS_CHECK_DEBOUNCE_MS);
  }

  async checkAliasAvailability(segment, generation) {
    const alias = instanceAliasFromSegment(segment);
    const params = new URLSearchParams({ alias });
    if (this.instance?.guid) {
      params.set("excludeInstanceGuid", this.instance.guid);
    }

    try {
      const { available } = await requestJson(
        `/api/genrpg/aliases/availability?${params.toString()}`,
      );

      if (generation !== this.aliasCheckGeneration) {
        return;
      }

      if (this.getUrlSegment() !== segment) {
        return;
      }

      if (available) {
        this.updateUrlHelpForAvailable(segment);
      } else {
        this.updateUrlHelpForInUse(segment);
      }
    } catch {
      if (generation !== this.aliasCheckGeneration) {
        return;
      }
      this.aliasInUse = false;
      this.aliasCheckPending = false;
      this.setUrlHelp("Could not verify URL availability.", "error");
      this.updateSubmitDisabled();
    }
  }

  onNameInput() {
    if (this.isManageMode()) {
      return;
    }
    const slug = slugifyInstanceUrlSegment(this.elements.$instanceNameInput.val());
    this.elements.$instanceUrlInput.val(slug);
    this.scheduleAliasAvailabilityCheck();
  }

  onUrlBlur() {
    let value = this.elements.$instanceUrlInput.val();
    if (!isProperlySlugified(value)) {
      value = slugifyInstanceUrlSegment(value);
      this.elements.$instanceUrlInput.val(value);
    }
    const segment = slugifyInstanceUrlSegment(value);
    if (segment === this.lastCheckedUrlSegment) {
      return;
    }
    this.scheduleAliasAvailabilityCheck();
  }

  setFormMessage(message, tone = "neutral") {
    setMessage(this.elements.$instanceMessage, message, tone);
  }

  setAddUserMessage(message, tone = "neutral") {
    if (this.elements.$addUserMessage) {
      setMessage(this.elements.$addUserMessage, message, tone);
    }
  }

  setDeleteMessage(message, tone = "neutral") {
    if (this.elements.$deleteInstanceMessage) {
      setMessage(this.elements.$deleteInstanceMessage, message, tone);
    }
  }

  setPackagesFieldEnabled(enabled) {
    this.elements.$instancePackageList.find('input[name="package"]').each(function () {
      const isGenrpg = this.dataset.machineName === "genrpg";
      this.disabled = !enabled || isGenrpg;
    });
    this.elements.$instancePackageList.toggleClass("is-readonly", !enabled);
  }

  resetForm() {
    this.cancelAliasCheckTimer();
    this.aliasCheckGeneration += 1;
    this.aliasInUse = false;
    this.aliasCheckPending = false;
    this.lastCheckedUrlSegment = "";
  }

  resetUsersTab() {
    this.usersTabLoaded = false;
    this.instanceUsersTable = null;
    this.elements.$addUserRoleForm?.[0]?.reset();
    this.setAddUserMessage("");
    this.elements.$instanceUsersList?.empty();
  }

  resetDeleteTab() {
    this.elements.$deleteInstanceConfirmInput?.val("");
    this.elements.$confirmDeleteInstanceButton?.prop("disabled", true).text("Delete Instance");
    this.setDeleteMessage("");
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
    if (!this.instance?.guid) {
      return;
    }
    try {
      const data = await requestJson(`/api/genrpg/instances/${this.instance.guid}/users`);
      this.buildInstanceUsersTable(data?.users || []);
    } catch (err) {
      this.instanceUsersTable = null;
      this.elements.$instanceUsersList.html(
        `<p class="empty-state">Failed to load users: ${escapeHtml(err.message)}</p>`,
      );
    }
  }

  async populateUserSelects() {
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

  updateConfirmButton() {
    const matches =
      this.elements.$deleteInstanceConfirmInput.val() === this.instance?.name;
    this.elements.$confirmDeleteInstanceButton.prop("disabled", !matches);
  }

  /**
   * @param {object|null} [instance] Omit to create; pass instance row to manage.
   */
  show(instance = null) {
    const isManage = Boolean(instance);

    this.createModalElement();
    this.resetForm();

    this.instance = isManage ? instance : null;
    this.setModalLayout();

    if (isManage) {
      this.setTitle(`Manage — ${instance.name}`);
      this.renderManageBody(instance);
    } else {
      this.setTitle("Create Instance");
      this.renderCreateBody();
      this.elements.$instanceForm?.[0]?.reset();
    }

    this.setFormMessage("");
    this.resetUsersTab();
    this.resetDeleteTab();

    if (isManage) {
      if (instance.can_delete) {
        this.elements.$deleteInstanceName.text(instance.name);
      }

      if (instance.can_edit) {
        const urlSegment = instance.url_segment || "";
        this.elements.$instanceNameInput.val(instance.name || "");
        this.elements.$instanceDescriptionInput.val(instance.description || "");
        this.elements.$instanceUrlInput.val(urlSegment);
        renderInstancePackageSelection(this.elements.$instancePackageList, {
          selectedPackages: instance.packageNames || [],
          readOnly: true,
        });
        this.setPackagesFieldEnabled(false);
        this.elements.$instanceSubmitButton.prop("disabled", false).text("Save Changes");
        this.scheduleAliasAvailabilityCheck();
      }
    } else {
      renderInstancePackageSelection(this.elements.$instancePackageList);
      this.setPackagesFieldEnabled(true);
      this.elements.$instanceSubmitButton.prop("disabled", false).text("Create Instance");
      this.updateUrlHelpForEmpty();
    }

    this.bindEvents();
    super.show();

    const activeTabId = this.tabbedRegion?.getActiveTab()?.id;
    if (this.isCreateMode() || activeTabId === "edit") {
      this.elements.$instanceNameInput?.trigger("focus");
    }
  }

  onHide() {
    this.resetForm();
    this.resetUsersTab();
    this.resetDeleteTab();
    this.destroyTabbedRegion();
    this.elements.$bodyHost?.empty();
    this.instance = null;
  }

  async onSubmit(event) {
    event.preventDefault();

    if (this.isManageMode() && !this.instance?.can_edit) {
      return;
    }

    const formData = new FormData(this.elements.$instanceForm[0]);

    if (this.aliasInUse || this.aliasCheckPending) {
      return;
    }

    const urlSegment = this.getUrlSegment();
    const $btn = this.elements.$instanceSubmitButton;
    $btn.prop("disabled", true);

    if (this.isManageMode()) {
      $btn.text("Saving…");
      const body = {
        name: formData.get("instanceName"),
        description: formData.get("description"),
        url: urlSegment,
      };

      try {
        await requestJson(`/api/genrpg/instances/${this.instance.guid}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        this.hide();
        setMessage(getElements().$message, "Instance updated.", "success");
        await loadApp();
      } catch (error) {
        this.setFormMessage(error.message, "error");
        $btn.prop("disabled", false).text("Save Changes");
        this.updateSubmitDisabled();
      }
      return;
    }

    const selectedPackages = getSelectedPackages(this.elements.$instancePackageList);
    if (!selectedPackages.length) {
      this.setFormMessage("Select at least one package.", "error");
      $btn.prop("disabled", false);
      return;
    }

    $btn.text("Creating…");
    const body = {
      name: formData.get("instanceName"),
      description: formData.get("description"),
      packages: selectedPackages,
    };
    if (urlSegment) {
      body.url = urlSegment;
    }

    try {
      await requestJson("/api/genrpg/instances", {
        method: "POST",
        body: JSON.stringify(body),
      });
      this.hide();
      setMessage(getElements().$message, "Instance created.", "success");
      await loadApp();
    } catch (error) {
      this.setFormMessage(error.message, "error");
      $btn.prop("disabled", false).text("Create Instance");
      this.updateSubmitDisabled();
    }
  }

  async onUsersFormSubmit(event) {
    event.preventDefault();
    if (!this.instance?.guid) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const userGuid = formData.get("userGuid");
    const roleId = Number(formData.get("roleId"));

    if (!userGuid || !roleId) {
      this.setAddUserMessage("Select a user and a role.", "error");
      return;
    }

    try {
      await requestJson(`/api/genrpg/instances/${this.instance.guid}/users/${userGuid}`, {
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
    const { guid } = this.instance;
    if (!guid) {
      return;
    }
    const $btn = $(event.currentTarget);
    const userGuid = $btn.data("user-guid");

    $btn.prop("disabled", true).text("Removing...");

    try {
      await requestJson(`/api/genrpg/instances/${guid}/users/${userGuid}`, {
        method: "DELETE",
      });
      this.setAddUserMessage("User removed.", "success");
      await this.loadInstanceUsers();
    } catch (error) {
      $btn.prop("disabled", false).text("Remove");
      this.setAddUserMessage(error.message, "error");
    }
  }

  async onConfirmDelete() {
    const { guid, name } = this.instance;
    if (!guid) {
      return;
    }

    const $btn = this.elements.$confirmDeleteInstanceButton;
    $btn.prop("disabled", true).text("Deleting...");

    try {
      await requestJson(`/api/genrpg/instances/${guid}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmName: name }),
      });
      this.hide();
      setMessage(getElements().$message, "Instance deleted.", "success");
      await loadApp();
    } catch (error) {
      this.setDeleteMessage(error.message, "error");
      $btn.text("Delete Instance");
      this.updateConfirmButton();
    }
  }
}

let manageInstanceModal = null;

export function getManageInstanceModal() {
  if (!manageInstanceModal) {
    manageInstanceModal = new ManageInstanceModal();
    manageInstanceModal.init();
  }
  return manageInstanceModal;
}

export function openCreateInstanceModal() {
  getManageInstanceModal().show();
}

export function openManageInstanceModal(instance) {
  getManageInstanceModal().show(instance);
}
