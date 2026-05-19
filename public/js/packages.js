import { getElements } from "./elements.js";
import { state } from "./state.js";
import { requestJson } from "./api.js";
import { escapeHtml, setMessage } from "./utils.js";
import { openManagePackagesModal } from "../components/modals/manage-packages/managePackagesModal.js";

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

export function setupPackageEvents() {
  const elements = getElements();

  elements.$packageList.on("change", 'input[name="package"]', function () {
    applyPackageSelectionChange(this.value, this.checked);
  });

  elements.$applyUpdatesButton.on("click", applyUpdates);

  elements.$managePackagesButton.on("click", () => openManagePackagesModal());
}
