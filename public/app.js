$(function () {
  const elements = {
    $instances: $("#instances"),
    $packageList: $("#packageList"),
    $message: $("#message"),
    $instanceCount: $("#instanceCount"),
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

  function renderInstances(instances) {
    elements.$instanceCount.text(`${instances.length} total`);

    if (!instances.length) {
      elements.$instances.html('<p class="empty-state">No instances yet.</p>');
      return;
    }

    elements.$instances.html(
      instances
        .map(
          (instance) => `
        <article class="instance-card">
          <div>
            <h3>${escapeHtml(instance.name)}</h3>
            <p>${escapeHtml(instance.description || "No description")}</p>
          </div>
          <dl>
            <div>
              <dt>Packages</dt>
              <dd>${escapeHtml((instance.packageNames || []).join(", ") || "None")}</dd>
            </div>
            <div>
              <dt>Permission</dt>
              <dd>${escapeHtml(instance.permission)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>${formatDate(instance.update_datetime)}</dd>
            </div>
          </dl>
        </article>
      `,
        )
        .join(""),
    );
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
      renderPackages(packages);
      renderInstances(instances);
      setMessage("");
      await checkForUpdates();
    } catch (error) {
      setMessage(error.message, "error");
    }
  }

  async function loadGitPackages() {
    elements.$gitPackagesList.html('<p class="empty-state">Loading installed packages...</p>');

    try {
      const data = await requestJson("/api/genrpg/packages/git/status");
      if (!data.statuses || data.statuses.length === 0) {
        elements.$gitPackagesList.html('<p class="empty-state">No git packages installed.</p>');
        return;
      }

      elements.$gitPackagesList.html(
        data.statuses
          .map(
            (pkg) => `
      <article class="instance-card" style="margin-bottom: 1rem;">
        <div>
          <h3>${escapeHtml(pkg.name)}</h3>
          <p>${escapeHtml(pkg.url)}</p>
        </div>
        <dl>
          <div><dt>Local</dt><dd>${escapeHtml(pkg.localVersion)}</dd></div>
          <div><dt>Remote</dt><dd>${escapeHtml(pkg.remoteVersion)}</dd></div>
          <div>
            ${
              pkg.canUpdate
                ? `<button type="button" class="primary-button update-git-pkg-btn" data-url="${escapeHtml(pkg.url)}">Update</button>`
                : "<span>Up to date</span>"
            }
          </div>
        </dl>
      </article>
    `,
          )
          .join(""),
      );
    } catch (err) {
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
