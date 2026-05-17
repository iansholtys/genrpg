import { getElements } from "./elements.js";
import { state } from "./state.js";
import { requestJson } from "./api.js";
import { escapeHtml, setMessage } from "./utils.js";
import { loadApp } from "./app.js";

function getTransitiveDependencies(machineName) {
  const dependencies = new Set();
  const queue = [];
  const pkg = state.packageByMachineName.get(machineName);

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
    const dependency = state.packageByMachineName.get(name);
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

  for (const pkg of state.packageByMachineName.values()) {
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

export function getSelectedPackages() {
  const elements = getElements();
  return elements.$packageList
    .find('input[name="package"]:checked')
    .map(function () {
      return this.value;
    })
    .get();
}

function getPackageCheckbox(machineName) {
  const elements = getElements();
  return elements.$packageList.find(
    `input[name="package"][data-machine-name="${machineName}"]`,
  );
}

function syncPackageCheckboxStates() {
  const selected = getSelectedPackages();
  const locked = getLockedDependencies(selected);

  for (const pkg of state.packageByMachineName.values()) {
    const $input = getPackageCheckbox(pkg.machineName);
    const isLocked = locked.has(pkg.machineName);
    $input.prop("disabled", isLocked);
    $input.closest(".package-option").toggleClass("is-locked", isLocked);
  }
}

export function applyPackageSelectionChange(machineName, isChecked) {
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

export function formatInstancePackageLabels(packageNames) {
  return (packageNames || [])
    .map((machineName) => state.packageNameByMachineName.get(machineName) || machineName)
    .join(", ") || "None";
}

export function renderPackages(packages) {
  const elements = getElements();
  state.packageByMachineName.clear();

  for (const pkg of packages) {
    state.packageByMachineName.set(pkg.machineName, pkg);
  }

  // Only show installed packages in the instance creation selector
  const installedPackages = packages.filter((pkg) => pkg.installed);

  if (!installedPackages.length) {
    elements.$packageList.html('<p class="empty-state">No packages installed. Use Manage Packages to install.</p>');
    return;
  }

  const defaultSelected = state.packageByMachineName.has("genrpg") && state.packageByMachineName.get("genrpg").installed
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

export function formatConfigurationIssues(issues) {
  return (issues || []).join(" ");
}

export function showConfigurationIssues(issues, { tone = "error" } = {}) {
  if (!issues?.length) {
    return;
  }

  const elements = getElements();
  setMessage(
    elements.$message,
    `Package configuration needs attention: ${formatConfigurationIssues(issues)}`,
    tone,
  );
}

function setPreviewMessage(message, tone = "neutral") {
  const elements = getElements();
  setMessage(elements.$packagePreviewMessage, message, tone);
}

export function showUpdateBanner() {
  const elements = getElements();
  elements.$updateBanner.prop("hidden", false);
}

export function hideUpdateBanner() {
  const elements = getElements();
  elements.$updateBanner.prop("hidden", true);
}

export async function checkForUpdates() {
  if (!state.currentUser?.admin) return;

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

export async function applyUpdates() {
  const elements = getElements();
  elements.$applyUpdatesButton.prop("disabled", true);

  try {
    await requestJson("/api/genrpg/update", {
      method: "POST",
      body: JSON.stringify({ update: true }),
    });
    hideUpdateBanner();
    setMessage(elements.$message, "Package updates applied.", "success");
    await checkForUpdates();
  } catch (error) {
    setMessage(elements.$message, error.message, "error");
  } finally {
    elements.$applyUpdatesButton.prop("disabled", false);
  }
}

function buildGitPackagesTable(statuses) {
  const elements = getElements();
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

  state.gitPackagesTable = new Table({
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

  elements.$gitPackagesList.empty().append(state.gitPackagesTable.init());
  state.gitPackagesTable.setData(statuses);
}

export async function loadGitPackages() {
  const elements = getElements();
  if (!state.gitPackagesTable) {
    elements.$gitPackagesList.html('<p class="empty-state">Loading packages...</p>');
  }

  try {
    const data = await requestJson("/api/genrpg/packages/git/status");
    buildGitPackagesTable(data?.statuses || []);
    showConfigurationIssues(data?.configurationIssues);
  } catch (err) {
    state.gitPackagesTable = null;
    elements.$gitPackagesList.html(
      `<p class="empty-state">Failed to load packages: ${escapeHtml(err.message)}</p>`,
    );
  }
}

export function setupPackageEvents() {
  const elements = getElements();

  elements.$packageList.on("change", 'input[name="package"]', function () {
    applyPackageSelectionChange(this.value, this.checked);
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
        loadApp();
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
        loadApp();
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

      state.currentPreviewUrl = repoUrl;
      elements.$packagePreviewResult.prop("hidden", false);
    } catch (error) {
      setPreviewMessage(error.message, "error");
    } finally {
      $submitButton.prop("disabled", false);
    }
  });

  elements.$pullPackageButton.on("click", async function () {
    if (!state.currentPreviewUrl) return;

    elements.$pullPackageButton.prop("disabled", true);
    setPreviewMessage("Pulling package...", "neutral");

    try {
      const result = await requestJson("/api/genrpg/packages/git/pull", {
        method: "POST",
        body: JSON.stringify({ url: state.currentPreviewUrl }),
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
      state.currentPreviewUrl = null;

      setTimeout(function () {
        elements.$packageModal[0].close();
        elements.$packagePreviewResult.prop("hidden", true);
        loadApp();
      }, 1500);
    } catch (error) {
      setPreviewMessage(error.message, "error");
    } finally {
      elements.$pullPackageButton.prop("disabled", false);
    }
  });
}
