let elements = null;

export function getElements() {
  if (!elements) {
    elements = {
      $instances: $("#instances"),
      $packageList: $("#packageList"),
      $message: $("#message"),
      $userLabel: $("#userLabel"),
      $instanceForm: $("#instanceForm"),
      $updateBanner: $("#updateBanner"),
      $applyUpdatesButton: $("#applyUpdatesButton"),
      $managePackagesButton: $("#managePackagesButton"),
      $exitInstanceButton: $("#exitInstanceButton"),
      $workspace: $("body > .workspace"),
      $instanceLoading: $("#instanceLoading"),
      $instanceLoadingName: $("#instanceLoadingName"),
      $instanceLoadingProgress: $("#instanceLoadingProgress"),
      $instanceLoadingStatus: $("#instanceLoadingStatus"),
      // Delete Instance modal
      $deleteInstanceModal: $("#deleteInstanceModal"),
      $closeDeleteInstanceModal: $("#closeDeleteInstanceModal"),
      $deleteInstanceName: $("#deleteInstanceName"),
      $deleteInstanceConfirmInput: $("#deleteInstanceConfirmInput"),
      $deleteInstanceMessage: $("#deleteInstanceMessage"),
      $confirmDeleteInstanceButton: $("#confirmDeleteInstanceButton"),
      // Manage Roles
      $manageRolesButton: $("#manageRolesButton"),
      // Manage Global Users
      $manageGlobalUsersButton: $("#manageGlobalUsersButton"),
    };
  }
  return elements;
}
