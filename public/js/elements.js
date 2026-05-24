let elements = null;

export function getElements() {
  if (!elements) {
    elements = {
      $instances: $("#instances"),
      $instancesHome: $(".instances-home"),
      $message: $("#message"),
      $userLabel: $("#userLabel"),
      $administrationSection: $("#administrationSection"),
      $updateBanner: $("#updateBanner"),
      $applyUpdatesButton: $("#applyUpdatesButton"),
      $managePackagesButton: $("#managePackagesButton"),
      $workspace: $("body > .workspace"),
      $instanceWorkspace: $("#instanceWorkspace"),
      $instanceTitle: $("#instanceTitle"),
      $instanceMessage: $("#instanceMessage"),
      $characterList: $("#characterList"),
      // Manage Roles
      $manageRolesButton: $("#manageRolesButton"),
      // Manage Global Users
      $manageGlobalUsersButton: $("#manageGlobalUsersButton"),
    };
  }
  return elements;
}
