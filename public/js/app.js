import { getElements } from "./elements.js";
import { state } from "./state.js";
import { requestJson } from "./api.js";
import { setMessage } from "./utils.js";
import { setupPackageEvents, renderPackages, showConfigurationIssues, checkForUpdates } from "./packages.js";
import {
  setupInstanceEvents,
  renderInstances,
  handleInitialInstanceNavigation,
} from "./instances.js";
import { setupRoleEvents } from "./roles.js";
import { setupUserEvents } from "./users.js";

export async function loadApp() {
  const elements = getElements();
  try {
    const [{ user }, { instances }, packagePayload] = await Promise.all([
      requestJson("/api/genrpg/me"),
      requestJson("/api/genrpg/instances"),
      requestJson("/api/genrpg/packages"),
    ]);
    const { packages, configurationIssues = [] } = packagePayload;

    state.currentUser = user;
    let label = user.email || user.displayName || "Signed in";
    if (user.admin) {
      label += " (admin)";
      elements.$packageTools.prop("hidden", false);
      elements.$managePackagesButton.prop("hidden", false);
      elements.$manageRolesButton.prop("hidden", false);
      elements.$manageGlobalUsersButton.prop("hidden", false);
    } else {
      elements.$packageTools.prop("hidden", true);
    }
    elements.$userLabel.text(label);
    
    state.packageNameByMachineName.clear();
    for (const pkg of packages) {
      state.packageNameByMachineName.set(pkg.machineName, pkg.name);
    }
    
    renderPackages(packages);
    renderInstances(instances);
    setMessage(elements.$message, "");
    showConfigurationIssues(configurationIssues);
    await checkForUpdates();
    await handleInitialInstanceNavigation();
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
