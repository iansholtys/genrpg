const instancesElement = document.querySelector("#instances");
const messageElement = document.querySelector("#message");
const countElement = document.querySelector("#instanceCount");
const userLabel = document.querySelector("#userLabel");
const form = document.querySelector("#instanceForm");

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

async function load() {
  try {
    const [{ user }, { instances }] = await Promise.all([
      requestJson("/api/me"),
      requestJson("/api/instances"),
    ]);

    userLabel.textContent = user.email || user.displayName || "Signed in";
    if (user.admin) userLabel.textContent += " (admin)";
    renderInstances(instances);
    setMessage("");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);

  try {
    await requestJson("/api/instances", {
      method: "POST",
      body: JSON.stringify({
        name: formData.get("name"),
        description: formData.get("description"),
      }),
    });
    form.reset();
    setMessage("Instance created.", "success");
    await load();
  } catch (error) {
    setMessage(error.message, "error");
  }
});

load();
