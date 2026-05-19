import { getElements } from "../../../js/elements.js";
import { requestJson } from "../../../js/api.js";
import { escapeHtml, setMessage } from "../../../js/utils.js";
import { loadApp } from "../../../js/app.js";

const Modal = window.Modal;

class ManagePackagesModal extends Modal {
  constructor() {
    super("manage-packages-modal", "Manage Packages", {
      maxWidth: "52rem",
      width: "92vw",
      enterAnimation: { preset: "scale-down", duration: 200 },
      exitAnimation: { preset: "scale-up", duration: 200 },
      classes: ["manage-packages-modal"],
    });
    this.currentPreviewUrl = null;
    this.gitPackagesTable = null;
  }

  getContent() {
    this.elements.$packagePreviewForm = $("<form>", { id: "packagePreviewForm" }).append(
      $("<label>").append(
        $("<span>", { text: "Git Repository URL" }),
        $("<input>", {
          type: "url",
          name: "repoUrl",
          required: true,
          placeholder: "git@github.com:user/repo.git",
          autocomplete: "off",
        }),
      ),
      $("<button>", { type: "submit", id: "previewPackageButton", text: "Preview Package" }),
    );

    this.elements.$gitPackagesList = $("<div>", {
      id: "gitPackagesList",
      class: "git-packages-list",
      role: "list",
    }).append($("<p>", { class: "empty-state", text: "Loading available packages..." }));

    this.elements.$installedGitPackages = $("<div>", {
      id: "installedGitPackages",
      class: "installed-packages-section",
    }).append(
      $("<hr>"),
      $("<h3>", { text: "Available Packages" }),
      this.elements.$gitPackagesList,
    );

    this.elements.$previewName = $("<dd>");
    this.elements.$previewMachineName = $("<dd>");
    this.elements.$previewRemoteVersion = $("<dd>");
    this.elements.$previewLocalVersion = $("<dd>");
    this.elements.$packagePreviewMessage = $("<div>", {
      class: "message",
      role: "status",
    });

    this.elements.$pullPackageButton = $("<button>", {
      type: "button",
      id: "pullPackageButton",
      class: "primary-button",
      text: "Pull Package",
    });

    this.elements.$packagePreviewResult = $("<div>", { id: "packagePreviewResult", hidden: true })
      .append(
        $("<hr>"),
        $("<h3>", { text: "Package Preview" }),
        $("<dl>").append(
          $("<div>").append($("<dt>", { text: "Name" }), this.elements.$previewName),
          $("<div>").append($("<dt>", { text: "Machine Name" }), this.elements.$previewMachineName),
          $("<div>").append($("<dt>", { text: "Remote Version" }), this.elements.$previewRemoteVersion),
          $("<div>").append($("<dt>", { text: "Local Version" }), this.elements.$previewLocalVersion),
        ),
        this.elements.$packagePreviewMessage,
        this.elements.$pullPackageButton,
      );

    return this.elements.$packagePreviewForm
      .add(this.elements.$installedGitPackages)
      .add(this.elements.$packagePreviewResult);
  }

  bindEvents() {
    super.bindEvents();
    this.elements.$packagePreviewForm.on("submit", (event) => this.onPreviewSubmit(event));
    this.elements.$gitPackagesList.on("click", ".update-git-pkg-btn", (event) =>
      this.onUpdateGitPackage(event),
    );
    this.elements.$gitPackagesList.on("click", ".install-git-pkg-btn", (event) =>
      this.onInstallGitPackage(event),
    );
    this.elements.$pullPackageButton.on("click", () => this.onPullPackage());
  }

  setPreviewMessage(message, tone = "neutral") {
    setMessage(this.elements.$packagePreviewMessage, message, tone);
  }

  buildGitPackagesTable(statuses) {
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

    this.gitPackagesTable = new Table({
      id: "git-packages-table",
      data: statuses,
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
    this.elements.$gitPackagesList.empty().append(this.gitPackagesTable.init());
  }

  async loadGitPackages() {
    if (!this.gitPackagesTable) {
      this.elements.$gitPackagesList.html('<p class="empty-state">Loading packages...</p>');
    }

    try {
      const data = await requestJson("/api/genrpg/packages/git/status");
      this.buildGitPackagesTable(data?.statuses || []);
      showConfigurationIssues(data?.configurationIssues);
    } catch (err) {
      this.gitPackagesTable = null;
      this.elements.$gitPackagesList.html(
        `<p class="empty-state">Failed to load packages: ${escapeHtml(err.message)}</p>`,
      );
    }
  }

  async show() {
    this.createModalElement();
    this.currentPreviewUrl = null;
    this.elements.$packagePreviewResult.prop("hidden", true);
    this.elements.$packagePreviewForm[0].reset();
    this.bindEvents();
    super.show();
    await this.loadGitPackages();
  }

  onHide() {
    this.currentPreviewUrl = null;
    this.gitPackagesTable = null;
  }

  async onPreviewSubmit(event) {
    event.preventDefault();
    const repoUrl = new FormData(event.currentTarget).get("repoUrl");
    const $submitButton = this.elements.$packagePreviewForm.find('button[type="submit"]');

    $submitButton.prop("disabled", true);
    this.setPreviewMessage("Previewing...", "neutral");
    this.elements.$packagePreviewResult.prop("hidden", true);

    try {
      const data = await requestJson("/api/genrpg/packages/git/preview", {
        method: "POST",
        body: JSON.stringify({ url: repoUrl }),
      });

      this.elements.$previewName.text(data.name);
      this.elements.$previewMachineName.text(data.machineName);
      this.elements.$previewRemoteVersion.text(data.remoteVersion);
      this.elements.$previewLocalVersion.text(data.localVersion || "Not installed");

      if (data.isNew) {
        this.elements.$pullPackageButton.text("Install Package");
        this.setPreviewMessage("This package is not currently installed.", "neutral");
      } else if (data.canUpdate) {
        this.elements.$pullPackageButton.text("Update Package");
        this.setPreviewMessage("An update is available for this package.", "success");
      } else {
        this.elements.$pullPackageButton.text("Reinstall Package");
        this.setPreviewMessage("This package is up to date.", "neutral");
      }

      this.currentPreviewUrl = repoUrl;
      this.elements.$packagePreviewResult.prop("hidden", false);
    } catch (error) {
      this.setPreviewMessage(error.message, "error");
    } finally {
      $submitButton.prop("disabled", false);
    }
  }

  async onPullPackage() {
    if (!this.currentPreviewUrl) return;

    this.elements.$pullPackageButton.prop("disabled", true);
    this.setPreviewMessage("Pulling package...", "neutral");

    try {
      const result = await requestJson("/api/genrpg/packages/git/pull", {
        method: "POST",
        body: JSON.stringify({ url: this.currentPreviewUrl }),
      });

      if (result.updateWarning) {
        this.setPreviewMessage(
          `Package pulled, but database migrations failed: ${result.updateWarning}`,
          "error",
        );
      } else if (result.configurationIssues?.length) {
        this.setPreviewMessage(
          `Package pulled. ${(result.configurationIssues || []).join(" ")}`,
          "error",
        );
      } else {
        this.setPreviewMessage("Package pulled successfully.", "success");
      }
      this.elements.$packagePreviewForm[0].reset();
      this.currentPreviewUrl = null;

      setTimeout(async () => {
        this.hide();
        this.elements.$packagePreviewResult.prop("hidden", true);
        await loadApp();
      }, 1500);
    } catch (error) {
      this.setPreviewMessage(error.message, "error");
    } finally {
      this.elements.$pullPackageButton.prop("disabled", false);
    }
  }

  async onUpdateGitPackage(event) {
    const $btn = $(event.currentTarget);
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
      setTimeout(async () => {
        await this.loadGitPackages();
        await loadApp();
      }, 1000);
    } catch (error) {
      $btn.prop("disabled", false).text("Error");
      alert("Failed to update: " + error.message);
    }
  }

  async onInstallGitPackage(event) {
    const $btn = $(event.currentTarget);
    const machineName = $btn.data("machine-name");

    $btn.prop("disabled", true).text("Installing...");

    try {
      await requestJson("/api/genrpg/packages/install", {
        method: "POST",
        body: JSON.stringify({ machineName }),
      });
      $btn.text("Installed!");
      setTimeout(async () => {
        await this.loadGitPackages();
        await loadApp();
      }, 1000);
    } catch (error) {
      $btn.prop("disabled", false).text("Install");
      alert("Failed to install: " + error.message);
    }
  }
}

let managePackagesModal = null;

function showConfigurationIssues(issues, { tone = "error" } = {}) {
  if (!issues?.length) {
    return;
  }
  setMessage(
    getElements().$message,
    `Package configuration needs attention: ${(issues || []).join(" ")}`,
    tone,
  );
}

export function getManagePackagesModal() {
  if (!managePackagesModal) {
    managePackagesModal = new ManagePackagesModal();
    managePackagesModal.init();
  }
  return managePackagesModal;
}

export async function openManagePackagesModal() {
  await getManagePackagesModal().show();
}
