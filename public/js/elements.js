let elements = null;

export function getElements() {
  if (!elements) {
    elements = {
      $instances: $("#instances"),
      $message: $("#message"),
      $userLabel: $("#userLabel"),
      $administrationSection: $("#administrationSection"),
      $updateBanner: $("#updateBanner"),
      $applyUpdatesButton: $("#applyUpdatesButton"),
      $managePackagesButton: $("#managePackagesButton"),
      $exitInstanceButton: $("#exitInstanceButton"),
      $workspace: $("body > .workspace"),
      $instanceLoading: $("#instanceLoading"),
      $instanceLoadingName: $("#instanceLoadingName"),
      $instanceLoadingProgress: $("#instanceLoadingProgress"),
      $instanceLoadingStatus: $("#instanceLoadingStatus"),
      // Manage Roles
      $manageRolesButton: $("#manageRolesButton"),
      // Manage Global Users
      $manageGlobalUsersButton: $("#manageGlobalUsersButton"),
    };
  }
  return elements;
}
