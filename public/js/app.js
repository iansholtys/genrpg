import { getElements } from "./elements.js";
import { requestJson } from "./api.js";
import { notify } from "./utils.js";
import { setupPackageEvents, checkForUpdates } from "./packages.js";
import { setupInstanceEvents, applyInitialRoute } from "./instances.js";
import { setupRoleEvents } from "./roles.js";
import { setupUserEvents } from "./users.js";
import {
  applyCurrentUser,
  isLandingUrl,
  loadLandingPage,
} from "./landing.js";

export async function loadApp() {
  try {
    const { user } = await requestJson("/api/genrpg/me");
    applyCurrentUser(user);

    if (isLandingUrl()) {
      await loadLandingPage();
    } else if (user?.admin) {
      await checkForUpdates();
    }

    await applyInitialRoute();
  } catch (error) {
    notify(error.message, "error");
  }
}

function initNotifications() {
  window.services = window.services || {};
  if (!window.services.notifications) {
    window.services.notifications = new Notifications();
    $("body").append(window.services.notifications.init());
  }
  return window.services.notifications;
}

// Initialize application
$(function () {
  initNotifications();

  // Ensure elements are cached
  getElements();

  // Set up all event listeners
  setupPackageEvents();
  setupInstanceEvents();
  setupRoleEvents();
  setupUserEvents();

  // Load initial data
  loadApp();
});
