import { getElements } from "./elements.js";
import { requestJson } from "./api.js";
import { setMessage } from "./utils.js";
import { setupPackageEvents } from "./packages.js";
import { setupInstanceEvents, applyInitialRoute } from "./instances.js";
import { setupRoleEvents } from "./roles.js";
import { setupUserEvents } from "./users.js";
import {
  applyCurrentUser,
  isLandingUrl,
  loadLandingPage,
} from "./landing.js";

export async function loadApp() {
  const elements = getElements();
  try {
    const { user } = await requestJson("/api/genrpg/me");
    applyCurrentUser(user);

    if (isLandingUrl()) {
      await loadLandingPage();
    }

    await applyInitialRoute();
  } catch (error) {
    setMessage(elements.$message, error.message, "error");
  }
}

// Initialize application
$(function () {
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
