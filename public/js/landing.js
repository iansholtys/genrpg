import { getElements } from "./elements.js";
import { state } from "./state.js";
import { requestJson } from "./api.js";
import {
  renderPackages,
  showConfigurationIssues,
  checkForUpdates,
} from "./packages.js";
import { renderInstances } from "./instances.js";

let landingPageLoaded = false;

/** True when the URL is home (/) and the server did not boot an instance. */
export function isLandingUrl() {
  if (window.__GENRPG_BOOT__?.type === "instance") {
    return false;
  }
  const alias = window.location.pathname.replace(/^\/+|\/+$/g, "");
  return !alias;
}

export function applyCurrentUser(user) {
  const elements = getElements();
  window.user = user ?? null;
  state.currentUser = user;

  let label = user?.email || user?.displayName || "Signed in";
  if (user?.admin) {
    elements.$administrationSection.prop("hidden", false);
    elements.$managePackagesButton.prop("hidden", false);
    elements.$manageRolesButton.prop("hidden", false);
    elements.$manageGlobalUsersButton.prop("hidden", false);
  } else {
    elements.$administrationSection.prop("hidden", true);
  }
  elements.$userLabel.text(label);
}

export async function loadLandingPage() {
  const [{ instances }, packagePayload] = await Promise.all([
    requestJson("/api/genrpg/instances"),
    requestJson("/api/genrpg/packages"),
  ]);
  const { packages, configurationIssues = [] } = packagePayload;

  state.packageNameByMachineName.clear();
  for (const pkg of packages) {
    state.packageNameByMachineName.set(pkg.machineName, pkg.name);
  }

  renderPackages(packages);
  renderInstances(instances);
  showConfigurationIssues(configurationIssues);
  await checkForUpdates();

  landingPageLoaded = true;
}

export async function ensureLandingPageLoaded() {
  if (landingPageLoaded) {
    return;
  }
  await loadLandingPage();
}
