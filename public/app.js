$(function () {
  const elements = {
    $instances: $("#instances"),
    $packageList: $("#packageList"),
    $message: $("#message"),
    $userLabel: $("#userLabel"),
    $instanceForm: $("#instanceForm"),
    $updateBanner: $("#updateBanner"),
    $applyUpdatesButton: $("#applyUpdatesButton"),
    $managePackagesButton: $("#managePackagesButton"),
    $packageModal: $("#packageModal"),
    $closePackageModal: $("#closePackageModal"),
    $packagePreviewForm: $("#packagePreviewForm"),
    $packagePreviewResult: $("#packagePreviewResult"),
    $pullPackageButton: $("#pullPackageButton"),
    $packagePreviewMessage: $("#packagePreviewMessage"),
    $gitPackagesList: $("#gitPackagesList"),
    $previewName: $("#previewName"),
    $previewMachineName: $("#previewMachineName"),
    $previewRemoteVersion: $("#previewRemoteVersion"),
    $previewLocalVersion: $("#previewLocalVersion"),
    $exitInstanceButton: $("#exitInstanceButton"),
    $workspace: $("body > .workspace"),
    $instanceLoading: $("#instanceLoading"),
    $instanceLoadingName: $("#instanceLoadingName"),
    $instanceLoadingProgress: $("#instanceLoadingProgress"),
    $instanceLoadingStatus: $("#instanceLoadingStatus"),
    // Manage Users modal
    $manageUsersModal: $("#manageUsersModal"),
    $closeManageUsersModal: $("#closeManageUsersModal"),
    $manageUsersInstanceName: $("#manageUsersInstanceName"),
    $addUserRoleForm: $("#addUserRoleForm"),
    $addUserSelect: $("#addUserSelect"),
    $addRoleSelect: $("#addRoleSelect"),
    $addUserMessage: $("#addUserMessage"),
    $instanceUsersList: $("#instanceUsersList"),
    // Delete Instance modal
    $deleteInstanceModal: $("#deleteInstanceModal"),
    $closeDeleteInstanceModal: $("#closeDeleteInstanceModal"),
    $deleteInstanceName: $("#deleteInstanceName"),
    $deleteInstanceConfirmInput: $("#deleteInstanceConfirmInput"),
    $deleteInstanceMessage: $("#deleteInstanceMessage"),
    $confirmDeleteInstanceButton: $("#confirmDeleteInstanceButton"),
    // Manage Roles
    $manageRolesButton: $("#manageRolesButton"),
    $manageRolesModal: $("#manageRolesModal"),
    $closeManageRolesModal: $("#closeManageRolesModal"),
    $roleForm: $("#roleForm"),
    $roleFormId: $("#roleFormId"),
    $roleNameInput: $("#roleNameInput"),
    $roleDescriptionInput: $("#roleDescriptionInput"),
    $rolePermissionsList: $("#rolePermissionsList"),
    $roleFormMessage: $("#roleFormMessage"),
    $roleFormSubmitButton: $("#roleFormSubmitButton"),
    $roleFormCancelButton: $("#roleFormCancelButton"),
    $rolesList: $("#rolesList"),
  };

  let currentUser = null;
  let currentPreviewUrl = null;
  let instancesTable = null;
  let gitPackagesTable = null;
  let activeInstance = null;
  let enteringInstance = false;
  let injectedStylesheets = [];
  let injectedScripts = [];
  const packageNameByMachineName = new Map();
  const packageByMachineName = new Map();
  let manageUsersInstanceGuid = null;
  let manageUsersInstanceName = null;
  let instanceUsersTable = null;
  let deleteInstanceGuid = null;
  let deleteInstanceTargetName = null;
  let allRoles = [];
  let allPermissions = [];
  let rolesTable = null;

  function getTransitiveDependencies(machineName) {
    const dependencies = new Set();
    const queue = [];
    const pkg = packageByMachineName.get(machineName);

    if (!pkg) {
      return dependencies;
    }

    for (const requirement of pkg.requirements) {
      queue.push(requirement.machineName);
    }

    while (queue.length) {
      const name = queue.shift();
      if (dependencies.has(name)) {
        continue;
      }

      dependencies.add(name);
      const dependency = packageByMachineName.get(name);
      if (!dependency) {
        continue;
      }

      for (const requirement of dependency.requirements) {
        queue.push(requirement.machineName);
      }
    }

    return dependencies;
  }

  function getTransitiveDependents(machineName) {
    const directDependents = new Map();

    for (const pkg of packageByMachineName.values()) {
      for (const requirement of pkg.requirements) {
        if (!directDependents.has(requirement.machineName)) {
          directDependents.set(requirement.machineName, []);
        }
        directDependents.get(requirement.machineName).push(pkg.machineName);
      }
    }

    const dependents = new Set();
    const queue = [machineName];

    while (queue.length) {
      const name = queue.shift();
      for (const dependent of directDependents.get(name) || []) {
        if (!dependents.has(dependent)) {
          dependents.add(dependent);
          queue.push(dependent);
        }
      }
    }

    return dependents;
  }

  function getLockedDependencies(selectedMachineNames) {
    const locked = new Set();

    for (const machineName of selectedMachineNames) {
      for (const dependency of getTransitiveDependencies(machineName)) {
        locked.add(dependency);
      }
    }

    return locked;
  }

  function getPackageCheckbox(machineName) {
    return elements.$packageList.find(
      `input[name="package"][data-machine-name="${machineName}"]`,
    );
  }

  function syncPackageCheckboxStates() {
    const selected = getSelectedPackages();
    const locked = getLockedDependencies(selected);

    for (const pkg of packageByMachineName.values()) {
      const $input = getPackageCheckbox(pkg.machineName);
      const isLocked = locked.has(pkg.machineName);
      $input.prop("disabled", isLocked);
      $input.closest(".package-option").toggleClass("is-locked", isLocked);
    }
  }

  function applyPackageSelectionChange(machineName, isChecked) {
    const $checkbox = getPackageCheckbox(machineName);

    if (isChecked) {
      $checkbox.prop("checked", true);
      for (const dependency of getTransitiveDependencies(machineName)) {
        getPackageCheckbox(dependency).prop("checked", true);
      }
    } else {
      $checkbox.prop("checked", false);
      for (const dependent of getTransitiveDependents(machineName)) {
        getPackageCheckbox(dependent).prop("checked", false);
      }
    }

    syncPackageCheckboxStates();
  }

  function formatInstancePackageLabels(packageNames) {
    return (packageNames || [])
      .map((machineName) => packageNameByMachineName.get(machineName) || machineName)
      .join(", ") || "None";
  }

  function setPreviewMessage(message, tone = "neutral") {
    elements.$packagePreviewMessage.text(message).attr("data-tone", tone);
  }

  function setMessage(message, tone = "neutral") {
    elements.$message.text(message).attr("data-tone", tone);
  }

  function formatConfigurationIssues(issues) {
    return (issues || []).join(" ");
  }

  function showConfigurationIssues(issues, { tone = "error" } = {}) {
    if (!issues?.length) {
      return;
    }

    setMessage(
      `Package configuration needs attention: ${formatConfigurationIssues(issues)}`,
      tone,
    );
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  function renderPackages(packages) {
    packageByMachineName.clear();

    for (const pkg of packages) {
      packageByMachineName.set(pkg.machineName, pkg);
    }

    // Only show installed packages in the instance creation selector
    const installedPackages = packages.filter((pkg) => pkg.installed);

    if (!installedPackages.length) {
      elements.$packageList.html('<p class="empty-state">No packages installed. Use Manage Packages to install.</p>');
      return;
    }

    const defaultSelected = packageByMachineName.has("genrpg") && packageByMachineName.get("genrpg").installed
      ? new Set(["genrpg"])
      : new Set();

    elements.$packageList.html(
      installedPackages
        .map(
          (pkg) => `
        <label class="package-option">
          <input
            type="checkbox"
            name="package"
            value="${escapeHtml(pkg.machineName)}"
            data-machine-name="${escapeHtml(pkg.machineName)}"
            ${defaultSelected.has(pkg.machineName) ? "checked" : ""}
          >
          <span>${escapeHtml(pkg.name)}</span>
        </label>
      `,
        )
        .join(""),
    );

    syncPackageCheckboxStates();
  }

  function ensureInstancesTable() {
    if (instancesTable) {
      return instancesTable;
    }

    instancesTable = new Table({
      id: "instances-table",
      rowCount: {
        show: true,
        nounSingular: "instance",
        nounPlural: "instances",
      },
      searchPlaceholder: "Search instances…",
      defaultSort: { field: "name" },
      columns: [
        { title: "Name", searchable: true },
        {
          title: "Description",
          searchable: true,
          valueFunction: (instance) => instance.description || "",
          renderFunction: (value) => escapeHtml(value || "No description"),
        },
        {
          title: "Packages",
          field: "packageNames",
          searchable: true,
          sortable: false,
          valueFunction: (instance) => formatInstancePackageLabels(instance.packageNames),
          searchFunction: (instance, searchTerm) =>
            (instance.packageNames || []).some((machineName) => {
              const label = packageNameByMachineName.get(machineName) || machineName;
              return (
                label.toLowerCase().includes(searchTerm) ||
                machineName.toLowerCase().includes(searchTerm)
              );
            }),
        },
        { title: "Role", field: "role" },
        {
          title: "Updated",
          field: "update_datetime",
          renderFunction: (value) => formatDate(value),
          sortFunction: (a, b) =>
            new Date(a.update_datetime).getTime() - new Date(b.update_datetime).getTime(),
        },
        {
          title: "Actions",
          sortable: false,
          headerClass: "actions-cell",
          cellClass: "actions-cell",
          renderFunction: (_value, instance) => {
            const $container = $("<div>", { class: "instance-actions" });

            $container.append(
              $("<button>", {
                type: "button",
                class: "primary-button enter-instance-btn",
                text: "Run",
              })
                .attr("data-instance-guid", instance.guid)
                .attr("data-instance-name", instance.name),
            );

            if (instance.can_manage_users) {
              $container.append(
                $("<button>", {
                  type: "button",
                  class: "accent-button-outline manage-users-btn",
                  text: "Users",
                })
                  .attr("data-instance-guid", instance.guid)
                  .attr("data-instance-name", instance.name),
              );
            }

            if (instance.can_delete) {
              $container.append(
                $("<button>", {
                  type: "button",
                  class: "danger-button-outline delete-instance-btn",
                  text: "Delete",
                })
                  .attr("data-instance-guid", instance.guid)
                  .attr("data-instance-name", instance.name),
              );
            }

            return $container;
          },
        },
      ],
      emptyState: {
        message: "No instances found",
        icon: "",
        detailNoData: "You have not created any instances yet.",
        detailFiltered: "No instances match your search.",
      },
    });

    elements.$instances.empty().append(instancesTable.init());
    return instancesTable;
  }

  function renderInstances(instances) {
    ensureInstancesTable().setData(instances);
  }

  function buildGitPackagesTable(statuses) {
    const hasUninstalled = statuses.some((pkg) => !pkg.installed);
    const hasActions = hasUninstalled || statuses.some((pkg) => pkg.canUpdate);

    const columns = [
      { title: "Name", searchable: true },
      { title: "Repository", field: "url", searchable: true },
    ];

    if (hasUninstalled) {
      columns.push({
        title: "Status",
        field: "installed",
        renderFunction: (_value, pkg) => {
          if (pkg.installed) {
            return $("<span>", { class: "table-status-installed", text: "Installed" });
          }
          return $("<span>", { class: "table-status-available", text: "Available" });
        },
      });
    }

    columns.push({ title: "Local Version" });
    columns.push({ title: "Remote Version" });

    if (hasActions) {
      columns.push({
        title: "Actions",
        sortable: false,
        headerClass: "actions-cell",
        cellClass: "actions-cell",
        renderFunction: (_value, pkg) => {
          if (!pkg.installed) {
            return $("<button>", {
              type: "button",
              class: "primary-button install-git-pkg-btn",
              text: "Install",
            }).attr("data-machine-name", pkg.machineName);
          }

          if (pkg.canUpdate) {
            return $("<button>", {
              type: "button",
              class: "primary-button update-git-pkg-btn",
              text: "Update",
            }).attr("data-url", pkg.url);
          }

          return $("<span>", { class: "table-status-muted", text: "Up to date" });
        },
      });
    }

    // Destroy the old table and build a fresh one with the right columns
    gitPackagesTable = new Table({
      id: "git-packages-table",
      rowCount: {
        show: true,
        nounSingular: "package",
        nounPlural: "packages",
      },
      searchPlaceholder: "Search packages…",
      defaultSort: { field: "name" },
      columns,
      emptyState: {
        message: "No packages found",
        icon: "",
        detailNoData: "No packages are available yet.",
        detailFiltered: "No matching packages.",
      },
    });

    elements.$gitPackagesList.empty().append(gitPackagesTable.init());
    gitPackagesTable.setData(statuses);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      }[character];
    });
  }

  function loadStylesheet(href) {
    return new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = () => resolve(link);
      link.onerror = () => reject(new Error(`Failed to load stylesheet: ${href}`));
      document.head.appendChild(link);
      injectedStylesheets.push(link);
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve(script);
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.body.appendChild(script);
      injectedScripts.push(script);
    });
  }

  function showInstanceLoading(instanceName, totalFiles) {
    const progressMax = totalFiles || 1;

    elements.$workspace.prop("hidden", true);
    elements.$instanceLoadingName.text(instanceName);
    elements.$instanceLoadingProgress.attr({ value: 0, max: progressMax });
    elements.$instanceLoadingStatus.text(
      totalFiles === 0 ? "Starting instance…" : `Loading 0 of ${totalFiles} files…`,
    );
    elements.$instanceLoading.prop("hidden", false);
  }

  function updateInstanceLoadingProgress(loaded, total) {
    const progressMax = total || 1;
    const progressValue = total === 0 ? progressMax : loaded;

    elements.$instanceLoadingProgress.attr({ value: progressValue, max: progressMax });
    elements.$instanceLoadingStatus.text(
      total === 0 ? "Starting instance…" : `Loading ${loaded} of ${total} files…`,
    );
  }

  function hideInstanceLoading() {
    elements.$instanceLoading.prop("hidden", true);
  }

  async function loadInstanceAssets({ css, js }, onProgress) {
    const stylesheetUrls = css || [];
    const scriptUrls = js || [];
    const total = stylesheetUrls.length + scriptUrls.length;

    if (total === 0) {
      onProgress?.(0, 0);
      return;
    }

    let loaded = 0;
    const reportProgress = () => {
      loaded += 1;
      onProgress?.(loaded, total);
    };

    await Promise.all(
      stylesheetUrls.map((href) =>
        loadStylesheet(href).then((link) => {
          reportProgress();
          return link;
        }),
      ),
    );

    for (const src of scriptUrls) {
      await loadScript(src);
      reportProgress();
    }
  }

  function exitInstance() {
    if (!activeInstance) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent("genrpg:instance-exited", {
        detail: { instanceGuid: activeInstance.guid },
      }),
    );

    for (const link of injectedStylesheets) {
      link.remove();
    }
    for (const script of injectedScripts) {
      script.remove();
    }
    injectedStylesheets = [];
    injectedScripts = [];
    activeInstance = null;
    hideInstanceLoading();
    elements.$exitInstanceButton.prop("hidden", true);
    elements.$workspace.prop("hidden", false);
  }

  async function enterInstance(instanceGuid, instanceName) {
    if (enteringInstance) {
      return;
    }

    enteringInstance = true;
    elements.$instances.find(".enter-instance-btn").prop("disabled", true);

    try {
      const assets = await requestJson(`/api/genrpg/instances/${instanceGuid}/assets`);
      if (!assets) {
        return;
      }

      const stylesheetUrls = assets.css || [];
      const scriptUrls = assets.js || [];
      const totalFiles = stylesheetUrls.length + scriptUrls.length;

      showInstanceLoading(instanceName, totalFiles);
      await loadInstanceAssets(
        { css: stylesheetUrls, js: scriptUrls },
        updateInstanceLoadingProgress,
      );
      hideInstanceLoading();

      activeInstance = {
        guid: instanceGuid,
        name: instanceName,
        packageNames: assets.packageNames || [],
      };

      window.dispatchEvent(
        new CustomEvent("genrpg:instance-entered", {
          detail: {
            instanceGuid: activeInstance.guid,
            packageNames: activeInstance.packageNames,
          },
        }),
      );

      elements.$exitInstanceButton.prop("hidden", false);
    } catch (error) {
      hideInstanceLoading();
      elements.$workspace.prop("hidden", false);

      for (const link of injectedStylesheets) {
        link.remove();
      }
      for (const script of injectedScripts) {
        script.remove();
      }
      injectedStylesheets = [];
      injectedScripts = [];
      setMessage(error.message, "error");
    } finally {
      enteringInstance = false;
      elements.$instances.find(".enter-instance-btn").prop("disabled", false);
    }
  }

  async function requestJson(url, options) {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });

    if (response.status === 401) {
      window.location.assign("/login");
      return null;
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    return data;
  }

  function getSelectedPackages() {
    return elements.$packageList
      .find('input[name="package"]:checked')
      .map(function () {
        return this.value;
      })
      .get();
  }

  function showUpdateBanner() {
    elements.$updateBanner.prop("hidden", false);
  }

  function hideUpdateBanner() {
    elements.$updateBanner.prop("hidden", true);
  }

  async function checkForUpdates() {
    if (!currentUser?.admin) return;

    const data = await requestJson("/api/genrpg/update", {
      method: "POST",
      body: JSON.stringify({}),
    });

    if (data?.updatesNeeded) {
      showUpdateBanner();
    } else {
      hideUpdateBanner();
    }
  }

  async function applyUpdates() {
    elements.$applyUpdatesButton.prop("disabled", true);

    try {
      await requestJson("/api/genrpg/update", {
        method: "POST",
        body: JSON.stringify({ update: true }),
      });
      hideUpdateBanner();
      setMessage("Package updates applied.", "success");
      await checkForUpdates();
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      elements.$applyUpdatesButton.prop("disabled", false);
    }
  }

  async function load() {
    try {
      const [{ user }, { instances }, packagePayload] = await Promise.all([
        requestJson("/api/genrpg/me"),
        requestJson("/api/genrpg/instances"),
        requestJson("/api/genrpg/packages"),
      ]);
      const { packages, configurationIssues = [] } = packagePayload;

      currentUser = user;
      let label = user.email || user.displayName || "Signed in";
      if (user.admin) {
        label += " (admin)";
        elements.$managePackagesButton.prop("hidden", false);
        elements.$manageRolesButton.prop("hidden", false);
      }
      elements.$userLabel.text(label);
      packageNameByMachineName.clear();
      for (const pkg of packages) {
        packageNameByMachineName.set(pkg.machineName, pkg.name);
      }
      renderPackages(packages);
      renderInstances(instances);
      setMessage("");
      showConfigurationIssues(configurationIssues);
      await checkForUpdates();
    } catch (error) {
      setMessage(error.message, "error");
    }
  }

  async function loadGitPackages() {
    if (!gitPackagesTable) {
      elements.$gitPackagesList.html('<p class="empty-state">Loading packages...</p>');
    }

    try {
      const data = await requestJson("/api/genrpg/packages/git/status");
      buildGitPackagesTable(data?.statuses || []);
      showConfigurationIssues(data?.configurationIssues);
    } catch (err) {
      gitPackagesTable = null;
      elements.$gitPackagesList.html(
        `<p class="empty-state">Failed to load packages: ${escapeHtml(err.message)}</p>`,
      );
    }
  }

  elements.$packageList.on("change", 'input[name="package"]', function () {
    applyPackageSelectionChange(this.value, this.checked);
  });

  elements.$instances.on("click", ".enter-instance-btn", function () {
    const $btn = $(this);
    enterInstance($btn.data("instance-guid"), $btn.data("instance-name"));
  });

  elements.$exitInstanceButton.on("click", exitInstance);

  // --- Manage Users Modal ---

  function setAddUserMessage(message, tone = "neutral") {
    elements.$addUserMessage.text(message).attr("data-tone", tone);
  }

  async function loadRoles() {
    if (allRoles.length) return allRoles;
    try {
      const data = await requestJson("/api/genrpg/roles");
      allRoles = data?.roles || [];
      return allRoles;
    } catch {
      return [];
    }
  }

  function buildInstanceUsersTable(users) {
    instanceUsersTable = new Table({
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

    elements.$instanceUsersList.empty().append(instanceUsersTable.init());
    instanceUsersTable.setData(users);
  }

  async function loadInstanceUsers() {
    if (!manageUsersInstanceGuid) return;
    try {
      const data = await requestJson(`/api/genrpg/instances/${manageUsersInstanceGuid}/users`);
      buildInstanceUsersTable(data?.users || []);
    } catch (err) {
      elements.$instanceUsersList.html(
        `<p class="empty-state">Failed to load users: ${escapeHtml(err.message)}</p>`,
      );
    }
  }

  async function openManageUsersModal(instanceGuid, instanceName) {
    manageUsersInstanceGuid = instanceGuid;
    manageUsersInstanceName = instanceName;
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

  elements.$instances.on("click", ".manage-users-btn", function () {
    const $btn = $(this);
    openManageUsersModal($btn.data("instance-guid"), $btn.data("instance-name"));
  });

  elements.$closeManageUsersModal.on("click", function () {
    elements.$manageUsersModal[0].close();
    manageUsersInstanceGuid = null;
    manageUsersInstanceName = null;
  });

  elements.$addUserRoleForm.on("submit", async function (event) {
    event.preventDefault();
    if (!manageUsersInstanceGuid) return;

    const formData = new FormData(this);
    const userGuid = formData.get("userGuid");
    const roleId = Number(formData.get("roleId"));

    if (!userGuid || !roleId) {
      setAddUserMessage("Select a user and a role.", "error");
      return;
    }

    try {
      await requestJson(`/api/genrpg/instances/${manageUsersInstanceGuid}/users/${userGuid}`, {
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
    if (!manageUsersInstanceGuid) return;
    const $btn = $(this);
    const userGuid = $btn.data("user-guid");

    $btn.prop("disabled", true).text("Removing...");

    try {
      await requestJson(`/api/genrpg/instances/${manageUsersInstanceGuid}/users/${userGuid}`, {
        method: "DELETE",
      });
      setAddUserMessage("User removed.", "success");
      await loadInstanceUsers();
    } catch (error) {
      $btn.prop("disabled", false).text("Remove");
      setAddUserMessage(error.message, "error");
    }
  });

  // --- Delete Instance Modal ---

  function setDeleteMessage(message, tone = "neutral") {
    elements.$deleteInstanceMessage.text(message).attr("data-tone", tone);
  }

  function openDeleteInstanceModal(instanceGuid, instanceName) {
    deleteInstanceGuid = instanceGuid;
    deleteInstanceTargetName = instanceName;
    elements.$deleteInstanceName.text(instanceName);
    elements.$deleteInstanceConfirmInput.val("");
    elements.$confirmDeleteInstanceButton.prop("disabled", true);
    setDeleteMessage("");
    elements.$deleteInstanceModal[0].showModal();
  }

  elements.$instances.on("click", ".delete-instance-btn", function () {
    const $btn = $(this);
    openDeleteInstanceModal($btn.data("instance-guid"), $btn.data("instance-name"));
  });

  elements.$closeDeleteInstanceModal.on("click", function () {
    elements.$deleteInstanceModal[0].close();
    deleteInstanceGuid = null;
    deleteInstanceTargetName = null;
  });

  elements.$deleteInstanceConfirmInput.on("input", function () {
    const matches = $(this).val() === deleteInstanceTargetName;
    elements.$confirmDeleteInstanceButton.prop("disabled", !matches);
  });

  elements.$confirmDeleteInstanceButton.on("click", async function () {
    if (!deleteInstanceGuid) return;

    const $btn = $(this);
    $btn.prop("disabled", true).text("Deleting...");

    try {
      await requestJson(`/api/genrpg/instances/${deleteInstanceGuid}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmName: deleteInstanceTargetName }),
      });
      elements.$deleteInstanceModal[0].close();
      setMessage("Instance deleted.", "success");
      deleteInstanceGuid = null;
      deleteInstanceTargetName = null;
      await load();
    } catch (error) {
      setDeleteMessage(error.message, "error");
      $btn.text("Delete Instance");
      // Re-enable only if name still matches
      const matches = elements.$deleteInstanceConfirmInput.val() === deleteInstanceTargetName;
      $btn.prop("disabled", !matches);
    }
  });

  // --- Manage Roles Modal ---

  function setRoleMessage(message, tone = "neutral") {
    elements.$roleFormMessage.text(message).attr("data-tone", tone);
  }

  async function loadPermissions() {
    if (allPermissions.length) return allPermissions;
    try {
      const data = await requestJson("/api/genrpg/permissions");
      allPermissions = data?.permissions || [];
      return allPermissions;
    } catch {
      return [];
    }
  }

  function resetRoleForm() {
    elements.$roleForm[0].reset();
    elements.$roleFormId.val("");
    elements.$roleFormSubmitButton.text("Create Role");
    elements.$roleFormCancelButton.prop("hidden", true);
    setRoleMessage("");
  }

  function buildRolesTable(roles) {
    if (!rolesTable) {
      rolesTable = new Table({
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
      elements.$rolesList.empty().append(rolesTable.init());
    }
    rolesTable.setData(roles);
  }

  async function reloadRolesData() {
    allRoles = []; // force reload
    const roles = await loadRoles();
    buildRolesTable(roles);
  }

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

  elements.$instanceForm.on("submit", async function (event) {
    event.preventDefault();
    const formData = new FormData(this);
    const selectedPackages = getSelectedPackages();

    if (!selectedPackages.length) {
      setMessage("Select at least one package.", "error");
      return;
    }

    try {
      await requestJson("/api/genrpg/instances", {
        method: "POST",
        body: JSON.stringify({
          name: formData.get("name"),
          description: formData.get("description"),
          packages: selectedPackages,
        }),
      });
      this.reset();
      setMessage("Instance created.", "success");
      await load();
    } catch (error) {
      setMessage(error.message, "error");
    }
  });

  elements.$applyUpdatesButton.on("click", applyUpdates);

  elements.$managePackagesButton.on("click", function () {
    elements.$packageModal[0].showModal();
    loadGitPackages();
  });

  elements.$closePackageModal.on("click", function () {
    elements.$packageModal[0].close();
  });

  elements.$gitPackagesList.on("click", ".update-git-pkg-btn", async function () {
    const $btn = $(this);
    const url = $btn.data("url");

    $btn.prop("disabled", true).text("Updating...");

    try {
      const result = await requestJson("/api/genrpg/packages/git/pull", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      $btn.text("Updated!");
      if (result.updateWarning) {
        alert(`Package updated, but database migrations failed: ${result.updateWarning}`);
      }
      showConfigurationIssues(result.configurationIssues, { tone: "error" });
      setTimeout(function () {
        loadGitPackages();
        load();
      }, 1000);
    } catch (error) {
      $btn.prop("disabled", false).text("Error");
      alert("Failed to update: " + error.message);
    }
  });

  elements.$gitPackagesList.on("click", ".install-git-pkg-btn", async function () {
    const $btn = $(this);
    const machineName = $btn.data("machine-name");

    $btn.prop("disabled", true).text("Installing...");

    try {
      await requestJson("/api/genrpg/packages/install", {
        method: "POST",
        body: JSON.stringify({ machineName }),
      });
      $btn.text("Installed!");
      setTimeout(function () {
        loadGitPackages();
        load();
      }, 1000);
    } catch (error) {
      $btn.prop("disabled", false).text("Install");
      alert("Failed to install: " + error.message);
    }
  });

  elements.$packagePreviewForm.on("submit", async function (event) {
    event.preventDefault();
    const repoUrl = new FormData(this).get("repoUrl");
    const $submitButton = $(this).find('button[type="submit"]');

    $submitButton.prop("disabled", true);
    setPreviewMessage("Previewing...", "neutral");
    elements.$packagePreviewResult.prop("hidden", true);

    try {
      const data = await requestJson("/api/genrpg/packages/git/preview", {
        method: "POST",
        body: JSON.stringify({ url: repoUrl }),
      });

      elements.$previewName.text(data.name);
      elements.$previewMachineName.text(data.machineName);
      elements.$previewRemoteVersion.text(data.remoteVersion);
      elements.$previewLocalVersion.text(data.localVersion || "Not installed");

      if (data.isNew) {
        elements.$pullPackageButton.text("Install Package");
        setPreviewMessage("This package is not currently installed.", "neutral");
      } else if (data.canUpdate) {
        elements.$pullPackageButton.text("Update Package");
        setPreviewMessage("An update is available for this package.", "success");
      } else {
        elements.$pullPackageButton.text("Reinstall Package");
        setPreviewMessage("This package is up to date.", "neutral");
      }

      currentPreviewUrl = repoUrl;
      elements.$packagePreviewResult.prop("hidden", false);
    } catch (error) {
      setPreviewMessage(error.message, "error");
    } finally {
      $submitButton.prop("disabled", false);
    }
  });

  elements.$pullPackageButton.on("click", async function () {
    if (!currentPreviewUrl) return;

    elements.$pullPackageButton.prop("disabled", true);
    setPreviewMessage("Pulling package...", "neutral");

    try {
      const result = await requestJson("/api/genrpg/packages/git/pull", {
        method: "POST",
        body: JSON.stringify({ url: currentPreviewUrl }),
      });

      if (result.updateWarning) {
        setPreviewMessage(
          `Package pulled, but database migrations failed: ${result.updateWarning}`,
          "error",
        );
      } else if (result.configurationIssues?.length) {
        setPreviewMessage(
          `Package pulled. ${formatConfigurationIssues(result.configurationIssues)}`,
          "error",
        );
      } else {
        setPreviewMessage("Package pulled successfully.", "success");
      }
      elements.$packagePreviewForm[0].reset();
      currentPreviewUrl = null;

      setTimeout(function () {
        elements.$packageModal[0].close();
        elements.$packagePreviewResult.prop("hidden", true);
        load();
      }, 1500);
    } catch (error) {
      setPreviewMessage(error.message, "error");
    } finally {
      elements.$pullPackageButton.prop("disabled", false);
    }
  });

  load();
});
