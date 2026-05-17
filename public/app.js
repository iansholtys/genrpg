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

    if (!packages.length) {
      elements.$packageList.html('<p class="empty-state">No packages available.</p>');
      return;
    }

    for (const pkg of packages) {
      packageByMachineName.set(pkg.machineName, pkg);
    }

    const defaultSelected = packageByMachineName.has("genrpg") ? new Set(["genrpg"]) : new Set();

    elements.$packageList.html(
      packages
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
        { title: "Permission" },
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
          renderFunction: (_value, instance) =>
            $("<button>", {
              type: "button",
              class: "primary-button enter-instance-btn",
              text: "Run",
            })
              .attr("data-instance-guid", instance.guid)
              .attr("data-instance-name", instance.name),
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

  function ensureGitPackagesTable() {
    if (gitPackagesTable) {
      return gitPackagesTable;
    }

    gitPackagesTable = new Table({
      id: "git-packages-table",
      rowCount: {
        show: true,
        nounSingular: "package",
        nounPlural: "packages",
      },
      searchPlaceholder: "Search installed packages…",
      defaultSort: { field: "name" },
      columns: [
        { title: "Name", searchable: true },
        { title: "Repository", field: "url", searchable: true },
        { title: "Local Version" },
        { title: "Remote Version" },
        {
          title: "Actions",
          sortable: false,
          headerClass: "actions-cell",
          cellClass: "actions-cell",
          renderFunction: (_value, pkg) => {
            if (pkg.canUpdate) {
              return $("<button>", {
                type: "button",
                class: "primary-button update-git-pkg-btn",
                text: "Update",
              }).attr("data-url", pkg.url);
            }

            return $("<span>", { class: "table-status-muted", text: "Up to date" });
          },
        },
      ],
      emptyState: {
        message: "No packages found",
        icon: "",
        detailNoData: "No packages are installed yet.",
        detailFiltered: "No matching installed packages.",
      },
    });

    elements.$gitPackagesList.empty().append(gitPackagesTable.init());
    return gitPackagesTable;
  }

  function renderGitPackages(statuses) {
    ensureGitPackagesTable().setData(statuses);
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

  async function loadInstanceAssets({ css, js }) {
    await Promise.all(css.map((href) => loadStylesheet(href)));
    for (const src of js) {
      await loadScript(src);
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
      setMessage("Loading instance…", "neutral");
      const assets = await requestJson(`/api/genrpg/instances/${instanceGuid}/assets`);
      await loadInstanceAssets(assets);

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
      elements.$workspace.prop("hidden", true);
      setMessage(`Entered instance "${instanceName}".`, "success");
    } catch (error) {
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
      elements.$gitPackagesList.html('<p class="empty-state">Loading installed packages...</p>');
    }

    try {
      const data = await requestJson("/api/genrpg/packages/git/status");
      renderGitPackages(data?.statuses || []);
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
