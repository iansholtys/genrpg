let elements = null;

export function getElements() {
  if (!elements) {
    elements = {
      $instances: $("#instances"),
      $instancesHome: $(".instances-home"),
      $userLabel: $("#userLabel"),
      $administrationSection: $("#administrationSection"),
      $updateBanner: $("#updateBanner"),
      $applyUpdatesButton: $("#applyUpdatesButton"),
      $managePackagesButton: $("#managePackagesButton"),
      $clearCacheButton: $("#clearCacheButton"),
      $workspace: $("body > .workspace"),
      // Manage Roles
      $manageRolesButton: $("#manageRolesButton"),
      // Manage Global Users
      $manageGlobalUsersButton: $("#manageGlobalUsersButton"),
    };
  }
  return elements;
}
