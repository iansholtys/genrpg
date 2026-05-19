import { getElements } from "./elements.js";
import { state } from "./state.js";
import { requestJson } from "./api.js";
import { escapeHtml, formatDate, setMessage } from "./utils.js";
import { formatInstancePackageLabels } from "./packages.js";
import { loadApp } from "./app.js";
import { openDeleteInstanceModal } from "../components/modals/delete-instance/deleteInstanceModal.js";
import { openCreateInstanceModal } from "../components/modals/create-instance/createInstanceModal.js";

function ensureInstancesTable() {
  const elements = getElements();
  if (state.instancesTable) {
    return state.instancesTable;
  }

  state.instancesTable = new Table({
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
            const label = state.packageNameByMachineName.get(machineName) || machineName;
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

  elements.$instances.empty().append(state.instancesTable.init());
  return state.instancesTable;
}

export function renderInstances(instances) {
  ensureInstancesTable().setData(instances);
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

function exitInstance({ syncUrl = false } = {}) {
  const elements = getElements();
  if (!state.activeInstance) {
    if (syncUrl && getCurrentAlias()) {
      setInstanceUrl("", { replace: true });
    }
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

  if (syncUrl) {
    setInstanceUrl("");
  }
}

async function enterInstance(instanceGuid, instanceName, { syncUrl = true } = {}) {
  const elements = getElements();
  if (state.enteringInstance) {
    return;
  }

  if (state.activeInstance) {
    exitInstance({ syncUrl: false });
  }

  state.enteringInstance = true;
  elements.$instances.find(".enter-instance-btn").prop("disabled", true);

  try {
    const assets = await requestJson(`/api/genrpg/instances/${instanceGuid}/assets`);
    if (!assets) {
      if (syncUrl && getCurrentAlias()) {
        setInstanceUrl("", { replace: true });
      }
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

    if (syncUrl) {
      const alias = await fetchAliasForInstance(instanceGuid);
      if (getCurrentAlias() !== alias) {
        setInstanceUrl(alias);
      }
    }
  } catch (error) {
    hideInstanceLoading();
    elements.$workspace.prop("hidden", false);

    for (const link of state.injectedStylesheets) {
      link.remove();
    }
    state.injectedStylesheets = [];
    state.injectedScripts = [];
    setMessage(elements.$message, error.message, "error");

    if (syncUrl && getCurrentAlias()) {
      setInstanceUrl("", { replace: true });
    }
  } finally {
    state.enteringInstance = false;
    elements.$instances.find(".enter-instance-btn").prop("disabled", false);
  }
}

async function handlePopState() {
  if (state.handlingPopstate || state.enteringInstance) {
    return;
  }

  state.handlingPopstate = true;
  const elements = getElements();

  try {
    const alias = getCurrentAlias();
    if (!alias) {
      if (state.activeInstance) {
        exitInstance({ syncUrl: false });
      }
      return;
    }

    const { resolved } = await requestJson(
      `/api/genrpg/aliases/resolve?alias=${encodeURIComponent(alias)}`,
    );

    if (resolved?.type === "instance") {
      if (state.activeInstance?.guid === resolved.guid) {
        return;
      }
      await enterInstance(resolved.guid, resolved.name, { syncUrl: false });
      return;
    }

    if (state.activeInstance) {
      exitInstance({ syncUrl: false });
    }

    if (alias.startsWith("instance/")) {
      setMessage(
        elements.$message,
        "Instance not found or you do not have access.",
        "error",
      );
    }
    setInstanceUrl("", { replace: true });
  } catch (error) {
    setMessage(elements.$message, error.message, "error");
  } finally {
    state.handlingPopstate = false;
  }
}

export async function handleInitialInstanceNavigation() {
  const elements = getElements();
  const boot = window.__GENRPG_BOOT__;
  delete window.__GENRPG_BOOT__;

  if (boot?.type === "instance") {
    await enterInstance(boot.guid, boot.name, { syncUrl: false });
    return;
  }

  const alias = getCurrentAlias();
  if (!alias) {
    return;
  }

  try {
    const { resolved } = await requestJson(
      `/api/genrpg/aliases/resolve?alias=${encodeURIComponent(alias)}`,
    );

    if (resolved?.type === "instance") {
      await enterInstance(resolved.guid, resolved.name, { syncUrl: false });
      return;
    }

    if (alias.startsWith("instance/")) {
      setMessage(
        elements.$message,
        "Instance not found or you do not have access.",
        "error",
      );
      setInstanceUrl("", { replace: true });
    }
  } catch (error) {
    setMessage(elements.$message, error.message, "error");
    if (getCurrentAlias()) {
      setInstanceUrl("", { replace: true });
    }
  }
}

export function setupInstanceEvents() {
  const elements = getElements();

  window.addEventListener("popstate", () => {
    handlePopState();
  });

  elements.$instances.on("click", ".enter-instance-btn", function () {
    const $btn = $(this);
    enterInstance($btn.data("instance-guid"), $btn.data("instance-name"));
  });

  elements.$exitInstanceButton.on("click", () => exitInstance({ syncUrl: true }));

  elements.$instances.on("click", ".delete-instance-btn", function () {
    const $btn = $(this);
    openDeleteInstanceModal($btn.data("instance-guid"), $btn.data("instance-name"));
  });

  elements.$createInstanceButton.on("click", () => openCreateInstanceModal());
}
