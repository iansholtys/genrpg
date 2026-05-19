import { getElements } from "./elements.js";
import { state } from "./state.js";
import { requestJson } from "./api.js";
import { setMessage } from "./utils.js";
import {
  openCreateInstanceModal,
  openManageInstanceModal,
} from "../components/modals/manage-instance/manageInstanceModal.js";

function canManageInstance(instance) {
  return instance.can_edit || instance.can_manage_users || instance.can_delete;
}

function buildInstanceTile(instance) {
  const description = instance.description?.trim() || "No description";
  const encoded = encodeURIComponent(JSON.stringify(instance));
  const $tile = $("<div>", { class: "instance-tile" });

  const $run = $("<button>", {
    type: "button",
    class: "instance-tile__main",
    "aria-label": `Run ${instance.name}. ${description}`,
  })
    .attr("data-instance-guid", instance.guid)
    .attr("data-instance-name", instance.name);

  $run.append(
    $("<span>", { class: "instance-tile__name", text: instance.name }),
    $("<span>", { class: "instance-tile__description", text: description }),
  );

  $tile.append($run);

  if (canManageInstance(instance)) {
    $tile.append(
      $("<button>", {
        type: "button",
        class: "instance-tile-manage secondary-button",
        text: "Manage",
        "aria-label": `Manage ${instance.name}`,
      }).attr("data-instance", encoded),
    );
  }

  return $tile;
}

export function renderInstances(instances) {
  const elements = getElements();
  const $grid = $("<div>", { class: "instance-tile-grid" });

  for (const instance of instances) {
    $grid.append(buildInstanceTile(instance));
  }

  $grid.append(
    $("<button>", {
      type: "button",
      class: "instance-tile instance-tile--create",
      text: "Create Instance",
      "aria-label": "Create Instance",
    }),
  );

  elements.$instances.empty().append($grid);
}

function loadStylesheet(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve(link);
    link.onerror = () => reject(new Error(`Failed to load stylesheet: ${href}`));
    document.head.appendChild(link);
    state.injectedStylesheets.push(link);
  });
}

function loadScript(src) {
  if (state.loadedInstanceScriptUrls.has(src)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => {
      state.loadedInstanceScriptUrls.add(src);
      resolve(script);
    };
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.body.appendChild(script);
    state.injectedScripts.push(script);
  });
}

function showInstanceLoading(instanceName, totalFiles) {
  const elements = getElements();
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
  const elements = getElements();
  const progressMax = total || 1;
  const progressValue = total === 0 ? progressMax : loaded;

  elements.$instanceLoadingProgress.attr({ value: progressValue, max: progressMax });
  elements.$instanceLoadingStatus.text(
    total === 0 ? "Starting instance…" : `Loading ${loaded} of ${total} files…`,
  );
}

function hideInstanceLoading() {
  const elements = getElements();
  elements.$instanceLoading.prop("hidden", true);
}

function dispatchPackageLoaded(packageName, instanceGuid) {
  window.dispatchEvent(
    new CustomEvent(`${packageName}:package-loaded`, {
      detail: { instanceGuid, packageName },
    }),
  );
}

function dispatchPackageExited(packageName, instanceGuid) {
  window.dispatchEvent(
    new CustomEvent(`${packageName}:package-exited`, {
      detail: { instanceGuid, packageName },
    }),
  );
}

async function loadPackageAssets({ css, js }, reportProgress) {
  const stylesheetUrls = css || [];
  const scriptUrls = js || [];

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

function getCurrentAlias() {
  return window.location.pathname.replace(/^\/+|\/+$/g, "");
}

function setInstanceUrl(alias, { replace = false } = {}) {
  const url = alias ? `/${alias}` : "/";
  const historyState = { genrpgAlias: alias || null };
  if (replace) {
    history.replaceState(historyState, "", url);
  } else {
    history.pushState(historyState, "", url);
  }
}

async function fetchAliasForInstance(instanceGuid) {
  const { alias } = await requestJson(
    `/api/genrpg/aliases/for-path?path=${encodeURIComponent(`instance:${instanceGuid}`)}`,
  );
  return alias || `instance/${instanceGuid}`;
}

async function loadInstanceAssets(packageAssetList, instanceGuid, onProgress) {
  const packages = packageAssetList || [];
  const total = packages.reduce(
    (count, pkg) => count + (pkg.css?.length || 0) + (pkg.js?.length || 0),
    0,
  );

  if (total === 0 && packages.length === 0) {
    onProgress?.(0, 0);
    return;
  }

  let loaded = 0;
  const reportProgress = () => {
    loaded += 1;
    onProgress?.(loaded, total || 1);
  };

  if (total === 0) {
    onProgress?.(0, 0);
  }

  for (const pkg of packages) {
    await loadPackageAssets(pkg, reportProgress);
    dispatchPackageLoaded(pkg.machineName, instanceGuid);
  }
}

function isStaleRoute(token) {
  return token !== state.routeToken;
}

function exitInstance() {
  const elements = getElements();
  if (!state.activeInstance) {
    return;
  }

  const { guid: instanceGuid, packageNames = [] } = state.activeInstance;
  for (const packageName of [...packageNames].reverse()) {
    dispatchPackageExited(packageName, instanceGuid);
  }

  window.dispatchEvent(
    new CustomEvent("genrpg:instance-exited", {
      detail: { instanceGuid },
    }),
  );

  for (const link of state.injectedStylesheets) {
    link.remove();
  }
  state.injectedStylesheets = [];
  state.injectedScripts = [];
  state.activeInstance = null;
  hideInstanceLoading();
  elements.$exitInstanceButton.prop("hidden", true);
  elements.$workspace.prop("hidden", false);
}

function clearEnteringState() {
  state.enteringInstance = false;
  getElements().$instances.find(".instance-tile button").prop("disabled", false);
}

function rejectRoute(token, message) {
  const elements = getElements();
  if (isStaleRoute(token)) {
    return;
  }

  exitInstance();
  clearEnteringState();
  if (message) {
    setMessage(elements.$message, message, "error");
  }
  if (getCurrentAlias()) {
    setInstanceUrl("", { replace: true });
  }
}

async function loadInstance(instanceGuid, instanceName, token) {
  const elements = getElements();

  if (state.activeInstance?.guid !== instanceGuid) {
    exitInstance();
  }

  if (isStaleRoute(token)) {
    return;
  }

  state.enteringInstance = true;
  elements.$instances.find(".instance-tile button").prop("disabled", true);

  try {
    const assets = await requestJson(`/api/genrpg/instances/${instanceGuid}/assets`);
    if (isStaleRoute(token)) {
      return;
    }

    if (!assets) {
      rejectRoute(token, "Instance not found or you do not have access.");
      return;
    }

    const packageAssetList = (assets.packages || []).map((pkg) => ({
      machineName: pkg.machineName,
      css: [...new Set(pkg.css || [])],
      js: [...new Set(pkg.js || [])],
    }));
    const totalFiles = packageAssetList.reduce(
      (count, pkg) => count + pkg.css.length + pkg.js.length,
      0,
    );

    showInstanceLoading(instanceName, totalFiles);
    await loadInstanceAssets(packageAssetList, instanceGuid, updateInstanceLoadingProgress);

    if (isStaleRoute(token)) {
      hideInstanceLoading();
      elements.$workspace.prop("hidden", false);
      return;
    }

    hideInstanceLoading();

    state.activeInstance = {
      guid: instanceGuid,
      name: instanceName,
      packageNames: assets.packageNames || [],
    };

    window.dispatchEvent(
      new CustomEvent("genrpg:instance-entered", {
        detail: {
          instanceGuid: state.activeInstance.guid,
          packageNames: state.activeInstance.packageNames,
        },
      }),
    );

    elements.$exitInstanceButton.prop("hidden", false);
  } catch (error) {
    if (isStaleRoute(token)) {
      hideInstanceLoading();
      elements.$workspace.prop("hidden", false);
      return;
    }

    hideInstanceLoading();
    elements.$workspace.prop("hidden", false);

    for (const link of state.injectedStylesheets) {
      link.remove();
    }
    state.injectedStylesheets = [];
    state.injectedScripts = [];
    rejectRoute(token, error.message);
  } finally {
    if (!isStaleRoute(token)) {
      clearEnteringState();
    }
  }
}

async function resolveAliasTarget(alias) {
  const { resolved } = await requestJson(
    `/api/genrpg/aliases/resolve?alias=${encodeURIComponent(alias)}`,
  );
  return resolved;
}

async function applyRoute({ boot = null } = {}) {
  const token = ++state.routeToken;
  const elements = getElements();
  const alias = getCurrentAlias();

  if (!alias) {
    exitInstance();
    clearEnteringState();
    return;
  }

  let target = boot?.type === "instance" ? boot : null;

  if (!target) {
    try {
      target = await resolveAliasTarget(alias);
    } catch (error) {
      if (isStaleRoute(token)) {
        return;
      }
      setMessage(elements.$message, error.message, "error");
      rejectRoute(token);
      return;
    }
  }

  if (isStaleRoute(token)) {
    return;
  }

  if (!target || target.type !== "instance") {
    const message = alias.startsWith("instance/")
      ? "Instance not found or you do not have access."
      : null;
    rejectRoute(token, message);
    return;
  }

  if (state.activeInstance?.guid === target.guid && !state.enteringInstance) {
    return;
  }

  await loadInstance(target.guid, target.name, token);
}

function navigateToAlias(alias, { replace = false } = {}) {
  setInstanceUrl(alias, { replace });
  return applyRoute();
}

async function navigateToInstance(instanceGuid) {
  const alias = await fetchAliasForInstance(instanceGuid);
  if (getCurrentAlias() === alias && state.activeInstance?.guid === instanceGuid) {
    return applyRoute();
  }
  setInstanceUrl(alias);
  return applyRoute();
}

export async function applyInitialRoute() {
  const boot = window.__GENRPG_BOOT__;
  delete window.__GENRPG_BOOT__;
  await applyRoute({ boot: boot?.type === "instance" ? boot : null });
}

export function setupInstanceEvents() {
  const elements = getElements();

  window.addEventListener("popstate", () => {
    applyRoute();
  });

  elements.$instances.on("click", ".instance-tile--create", () => {
    openCreateInstanceModal();
  });

  elements.$instances.on("click", ".instance-tile-manage", function (event) {
    event.stopPropagation();
    const raw = $(this).attr("data-instance");
    if (!raw) {
      return;
    }
    openManageInstanceModal(JSON.parse(decodeURIComponent(raw)));
  });

  elements.$instances.on("click", ".instance-tile__main", function () {
    navigateToInstance($(this).data("instance-guid"));
  });

  elements.$exitInstanceButton.on("click", () => navigateToAlias(""));
}
