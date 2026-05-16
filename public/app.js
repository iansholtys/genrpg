const instancesElement = document.querySelector("#instances");
const packageListElement = document.querySelector("#packageList");
const messageElement = document.querySelector("#message");
const countElement = document.querySelector("#instanceCount");
const userLabel = document.querySelector("#userLabel");
const form = document.querySelector("#instanceForm");
const updateBanner = document.querySelector("#updateBanner");
const applyUpdatesButton = document.querySelector("#applyUpdatesButton");
const managePackagesButton = document.querySelector("#managePackagesButton");
const packageModal = document.querySelector("#packageModal");
const closePackageModal = document.querySelector("#closePackageModal");
const packagePreviewForm = document.querySelector("#packagePreviewForm");
const packagePreviewResult = document.querySelector("#packagePreviewResult");
const pullPackageButton = document.querySelector("#pullPackageButton");
const packagePreviewMessage = document.querySelector("#packagePreviewMessage");
const gitPackagesList = document.querySelector("#gitPackagesList");

let currentUser = null;
let currentPreviewUrl = null;

function setPreviewMessage(message, tone = "neutral") {
  packagePreviewMessage.textContent = message;
  packagePreviewMessage.dataset.tone = tone;
}

function setMessage(message, tone = "neutral") {
  messageElement.textContent = message;
  messageElement.dataset.tone = tone;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function renderPackages(packages) {
  if (!packages.length) {
    packageListElement.innerHTML = '<p class="empty-state">No packages available.</p>';
    return;
  }

  packageListElement.innerHTML = packages
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
    .join("");
}

function renderInstances(instances) {
  countElement.textContent = `${instances.length} total`;

  if (!instances.length) {
    instancesElement.innerHTML = '<p class="empty-state">No instances yet.</p>';
    return;
  }

  instancesElement.innerHTML = instances
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
    .join("");
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
  return [...form.querySelectorAll('input[name="package"]:checked')].map((input) => input.value);
}

function showUpdateBanner() {
  updateBanner.hidden = false;
}

function hideUpdateBanner() {
  updateBanner.hidden = true;
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
  applyUpdatesButton.disabled = true;

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
    applyUpdatesButton.disabled = false;
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
    userLabel.textContent = user.email || user.displayName || "Signed in";
    if (user.admin) {
      userLabel.textContent += " (admin)";
      managePackagesButton.hidden = false;
    }
    renderPackages(packages);
    renderInstances(instances);
    setMessage("");
    await checkForUpdates();
  } catch (error) {
    setMessage(error.message, "error");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
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
    form.reset();
    setMessage("Instance created.", "success");
    await load();
  } catch (error) {
    setMessage(error.message, "error");
  }
});

applyUpdatesButton.addEventListener("click", applyUpdates);

async function loadGitPackages() {
  gitPackagesList.innerHTML = '<p class="empty-state">Loading installed packages...</p>';
  try {
    const data = await requestJson("/api/genrpg/packages/git/status");
    if (!data.statuses || data.statuses.length === 0) {
      gitPackagesList.innerHTML = '<p class="empty-state">No git packages installed.</p>';
      return;
    }

    gitPackagesList.innerHTML = data.statuses.map(pkg => `
      <article class="instance-card" style="margin-bottom: 1rem;">
        <div>
          <h3>${escapeHtml(pkg.name)}</h3>
          <p>${escapeHtml(pkg.url)}</p>
        </div>
        <dl>
          <div><dt>Local</dt><dd>${escapeHtml(pkg.localVersion)}</dd></div>
          <div><dt>Remote</dt><dd>${escapeHtml(pkg.remoteVersion)}</dd></div>
          <div>
            ${pkg.canUpdate 
              ? `<button type="button" class="primary-button update-git-pkg-btn" data-url="${escapeHtml(pkg.url)}">Update</button>`
              : `<span>Up to date</span>`
            }
          </div>
        </dl>
      </article>
    `).join("");

    gitPackagesList.querySelectorAll(".update-git-pkg-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const url = e.target.dataset.url;
        e.target.disabled = true;
        e.target.textContent = "Updating...";
        
        try {
          await requestJson("/api/genrpg/packages/git/pull", {
            method: "POST",
            body: JSON.stringify({ url }),
          });
          e.target.textContent = "Updated!";
          setTimeout(() => {
            loadGitPackages();
            load();
          }, 1000);
        } catch (error) {
          e.target.disabled = false;
          e.target.textContent = "Error";
          alert("Failed to update: " + error.message);
        }
      });
    });
  } catch (err) {
    gitPackagesList.innerHTML = `<p class="empty-state">Failed to load packages: ${escapeHtml(err.message)}</p>`;
  }
}

managePackagesButton.addEventListener("click", () => {
  packageModal.showModal();
  loadGitPackages();
});

closePackageModal.addEventListener("click", () => {
  packageModal.close();
});

packagePreviewForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(packagePreviewForm);
  const repoUrl = formData.get("repoUrl");

  const submitButton = packagePreviewForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  setPreviewMessage("Previewing...", "neutral");
  packagePreviewResult.hidden = true;

  try {
    const data = await requestJson("/api/genrpg/packages/git/preview", {
      method: "POST",
      body: JSON.stringify({ url: repoUrl }),
    });

    document.querySelector("#previewName").textContent = data.name;
    document.querySelector("#previewMachineName").textContent = data.machineName;
    document.querySelector("#previewRemoteVersion").textContent = data.remoteVersion;
    document.querySelector("#previewLocalVersion").textContent = data.localVersion || "Not installed";
    
    if (data.isNew) {
      pullPackageButton.textContent = "Install Package";
      setPreviewMessage("This package is not currently installed.", "neutral");
    } else if (data.canUpdate) {
      pullPackageButton.textContent = "Update Package";
      setPreviewMessage("An update is available for this package.", "success");
    } else {
      pullPackageButton.textContent = "Reinstall Package";
      setPreviewMessage("This package is up to date.", "neutral");
    }

    currentPreviewUrl = repoUrl;
    packagePreviewResult.hidden = false;
  } catch (error) {
    setPreviewMessage(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

pullPackageButton.addEventListener("click", async () => {
  if (!currentPreviewUrl) return;

  pullPackageButton.disabled = true;
  setPreviewMessage("Pulling package...", "neutral");

  try {
    await requestJson("/api/genrpg/packages/git/pull", {
      method: "POST",
      body: JSON.stringify({ url: currentPreviewUrl }),
    });

    setPreviewMessage("Package pulled successfully.", "success");
    packagePreviewForm.reset();
    currentPreviewUrl = null;
    
    setTimeout(() => {
      packageModal.close();
      packagePreviewResult.hidden = true;
      load();
    }, 1500);
  } catch (error) {
    setPreviewMessage(error.message, "error");
  } finally {
    pullPackageButton.disabled = false;
  }
});

load();
