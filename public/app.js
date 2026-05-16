const instancesElement = document.querySelector("#instances");
const packageListElement = document.querySelector("#packageList");
const messageElement = document.querySelector("#message");
const countElement = document.querySelector("#instanceCount");
const userLabel = document.querySelector("#userLabel");
const form = document.querySelector("#instanceForm");
const updateBanner = document.querySelector("#updateBanner");
const applyUpdatesButton = document.querySelector("#applyUpdatesButton");

let currentUser = null;

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
    if (user.admin) userLabel.textContent += " (admin)";
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

load();
