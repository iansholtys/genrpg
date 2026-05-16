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
  };

  let currentUser = null;
  let currentPreviewUrl = null;
  let instancesTable = null;
  let gitPackagesTable = null;
  const packageNameByMachineName = new Map();

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

  function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  function renderPackages(packages) {
    if (!packages.length) {
      elements.$packageList.html('<p class="empty-state">No packages available.</p>');
      return;
    }

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
            checked
          >
          <span>${escapeHtml(pkg.name)}</span>
        </label>
      `,
        )
        .join(""),
    );
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
          sortable: false,
          valueFunction: (instance) => formatInstancePackageLabels(instance.packageNames),
        },
        { title: "Permission" },
        {
          title: "Updated",
          field: "update_datetime",
          renderFunction: (value) => formatDate(value),
          sortFunction: (a, b) =>
            new Date(a.update_datetime).getTime() - new Date(b.update_datetime).getTime(),
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
      const [{ user }, { instances }, { packages }] = await Promise.all([
        requestJson("/api/genrpg/me"),
        requestJson("/api/genrpg/instances"),
        requestJson("/api/genrpg/packages"),
      ]);

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
    } catch (err) {
      gitPackagesTable = null;
      elements.$gitPackagesList.html(
        `<p class="empty-state">Failed to load packages: ${escapeHtml(err.message)}</p>`,
      );
    }
  }

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
      await requestJson("/api/genrpg/packages/git/pull", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      $btn.text("Updated!");
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
      await requestJson("/api/genrpg/packages/git/pull", {
        method: "POST",
        body: JSON.stringify({ url: currentPreviewUrl }),
      });

      setPreviewMessage("Package pulled successfully.", "success");
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
