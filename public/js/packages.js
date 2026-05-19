import { state } from "./state.js";
import { requestJson } from "./api.js";
import { escapeHtml, setMessage } from "./utils.js";
import { getElements } from "./elements.js";
import { openManagePackagesModal } from "../components/modals/manage-packages/managePackagesModal.js";

const GENRPG_MACHINE_NAME = "genrpg";

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

export function orderPackagesByDependency(installedPackages) {
  const installedSet = new Set(installedPackages.map((pkg) => pkg.machineName));
  const byName = new Map(installedPackages.map((pkg) => [pkg.machineName, pkg]));
  const depthMemo = new Map();

  function getDepth(machineName) {
    if (depthMemo.has(machineName)) {
      return depthMemo.get(machineName);
    }

    const pkg = byName.get(machineName);
    if (!pkg) {
      return 0;
    }

    const installedRequirements = pkg.requirements
      .map((requirement) => requirement.machineName)
      .filter((name) => installedSet.has(name));

    const depth =
      installedRequirements.length === 0
        ? 0
        : 1 + Math.max(...installedRequirements.map((name) => getDepth(name)));

    depthMemo.set(machineName, depth);
    return depth;
  }

  function getParentMachineName(machineName) {
    const pkg = byName.get(machineName);
    const installedRequirements = pkg.requirements
      .map((requirement) => requirement.machineName)
      .filter((name) => installedSet.has(name));

    if (installedRequirements.length === 0) {
      return null;
    }

    return installedRequirements.sort((a, b) => {
      const depthDifference = getDepth(b) - getDepth(a);
      if (depthDifference !== 0) {
        return depthDifference;
      }
      return a.localeCompare(b);
    })[0];
  }

  const childrenByParent = new Map();

  for (const pkg of installedPackages) {
    const parent = getParentMachineName(pkg.machineName);
    const parentKey = parent ?? "";
    if (!childrenByParent.has(parentKey)) {
      childrenByParent.set(parentKey, []);
    }
    childrenByParent.get(parentKey).push(pkg);
  }

  for (const children of childrenByParent.values()) {
    children.sort((a, b) => a.name.localeCompare(b.name));
  }

  const ordered = [];

  function walk(parentKey, depth) {
    for (const pkg of childrenByParent.get(parentKey) || []) {
      ordered.push({ pkg, depth });
      walk(pkg.machineName, depth + 1);
    }
  }

  walk("", 0);
  return ordered;
}

export function getSelectedPackages($container) {
  return $container
    .find('input[name="package"]:checked')
    .map(function () {
      return this.value;
    })
    .get();
}

function getPackageCheckbox($container, machineName) {
  return $container.find(`input[name="package"][data-machine-name="${machineName}"]`);
}

function syncPackageCheckboxStates($container) {
  const selected = getSelectedPackages($container);
  const locked = getLockedDependencies(selected);

  for (const pkg of state.packageByMachineName.values()) {
    const $input = getPackageCheckbox($container, pkg.machineName);
    if (!$input.length) {
      continue;
    }

    if (pkg.machineName === GENRPG_MACHINE_NAME) {
      $input.prop({ checked: true, disabled: true });
      $input.closest(".package-option").addClass("is-required").removeClass("is-locked");
      continue;
    }

    const isLocked = locked.has(pkg.machineName);
    $input.prop("disabled", isLocked);
    $input.closest(".package-option").toggleClass("is-locked", isLocked).removeClass("is-required");
  }
}

export function applyPackageSelectionChange(machineName, isChecked, $container) {
  const $checkbox = getPackageCheckbox($container, machineName);

  if (machineName === GENRPG_MACHINE_NAME) {
    $checkbox.prop("checked", true);
    syncPackageCheckboxStates($container);
    return;
  }

  if (isChecked) {
    $checkbox.prop("checked", true);
    for (const dependency of getTransitiveDependencies(machineName)) {
      getPackageCheckbox($container, dependency).prop("checked", true);
    }
  } else {
    $checkbox.prop("checked", false);
    for (const dependent of getTransitiveDependents(machineName)) {
      getPackageCheckbox($container, dependent).prop("checked", false);
    }
  }

  syncPackageCheckboxStates($container);
}

export function formatInstancePackageLabels(packageNames) {
  return (packageNames || [])
    .map((machineName) => state.packageNameByMachineName.get(machineName) || machineName)
    .join(", ") || "None";
}

export function renderInstancePackageSelection($container) {
  const installedPackages = [...state.packageByMachineName.values()].filter((pkg) => pkg.installed);

  if (!installedPackages.length) {
    $container.html('<p class="empty-state">No packages installed. Use Manage Packages to install.</p>');
    return;
  }

  const defaultSelected =
    state.packageByMachineName.has(GENRPG_MACHINE_NAME) &&
    state.packageByMachineName.get(GENRPG_MACHINE_NAME).installed
      ? new Set([GENRPG_MACHINE_NAME])
      : new Set();

  const orderedPackages = orderPackagesByDependency(installedPackages);

  $container.html(
    orderedPackages
      .map(({ pkg, depth }) => {
        const isGenrpg = pkg.machineName === GENRPG_MACHINE_NAME;
        const isChecked = defaultSelected.has(pkg.machineName);
        const checkedAttr = isChecked ? "checked" : "";
        const disabledAttr = isGenrpg ? "disabled" : "";
        const requiredClass = isGenrpg ? " is-required" : "";

        return `
      <label class="package-option${requiredClass}" style="--package-depth: ${depth}">
        <input
          type="checkbox"
          name="package"
          value="${escapeHtml(pkg.machineName)}"
          data-machine-name="${escapeHtml(pkg.machineName)}"
          ${checkedAttr}
          ${disabledAttr}
        >
        <span>${escapeHtml(pkg.name)}</span>
      </label>
    `;
      })
      .join(""),
  );

  syncPackageCheckboxStates($container);
}

export function setPackages(packages) {
  state.packageByMachineName.clear();

  for (const pkg of packages) {
    state.packageByMachineName.set(pkg.machineName, pkg);
  }
}

export function renderPackages(packages) {
  setPackages(packages);
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

  elements.$applyUpdatesButton.on("click", applyUpdates);

  elements.$managePackagesButton.on("click", () => openManagePackagesModal());
}
