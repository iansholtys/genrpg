import { getElements } from "./elements.js";
import { state } from "./state.js";
import { requestJson } from "./api.js";
import { escapeHtml, formatDate, setMessage } from "./utils.js";
import { getSelectedPackages, formatInstancePackageLabels } from "./packages.js";
import { loadApp } from "./app.js";
import { openDeleteInstanceModal } from "../components/modals/delete-instance/deleteInstanceModal.js";

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
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve(script);
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
  const elements = getElements();
  if (!state.activeInstance) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("genrpg:instance-exited", {
      detail: { instanceGuid: state.activeInstance.guid },
    }),
  );

  for (const link of state.injectedStylesheets) {
    link.remove();
  }
  for (const script of state.injectedScripts) {
    script.remove();
  }
  state.injectedStylesheets = [];
  state.injectedScripts = [];
  state.activeInstance = null;
  hideInstanceLoading();
  elements.$exitInstanceButton.prop("hidden", true);
  elements.$workspace.prop("hidden", false);
}

async function enterInstance(instanceGuid, instanceName) {
  const elements = getElements();
  if (state.enteringInstance) {
    return;
  }

  state.enteringInstance = true;
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
    hideInstanceLoading();
    elements.$workspace.prop("hidden", false);

    for (const link of state.injectedStylesheets) {
      link.remove();
    }
    for (const script of state.injectedScripts) {
      script.remove();
    }
    state.injectedStylesheets = [];
    state.injectedScripts = [];
    setMessage(elements.$message, error.message, "error");
  } finally {
    state.enteringInstance = false;
    elements.$instances.find(".enter-instance-btn").prop("disabled", false);
  }
}

export function setupInstanceEvents() {
  const elements = getElements();

  elements.$instances.on("click", ".enter-instance-btn", function () {
    const $btn = $(this);
    enterInstance($btn.data("instance-guid"), $btn.data("instance-name"));
  });

  elements.$exitInstanceButton.on("click", exitInstance);

  elements.$instances.on("click", ".delete-instance-btn", function () {
    const $btn = $(this);
    openDeleteInstanceModal($btn.data("instance-guid"), $btn.data("instance-name"));
  });

  elements.$instanceForm.on("submit", async function (event) {
    event.preventDefault();
    const formData = new FormData(this);
    const selectedPackages = getSelectedPackages();

    if (!selectedPackages.length) {
      setMessage(elements.$message, "Select at least one package.", "error");
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
      setMessage(elements.$message, "Instance created.", "success");
      await loadApp();
    } catch (error) {
      setMessage(elements.$message, error.message, "error");
    }
  });
}
