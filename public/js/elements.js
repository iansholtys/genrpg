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
      $packageModal: $("#packageModal"),
      $closePackageModal: $("#closePackageModal"),
      $packagePreviewForm: $("#packagePreviewForm"),
      $packagePreviewResult: $("#packagePreviewResult"),
      $pullPackageButton: $("#pullPackageButton"),
      $packagePreviewMessage: $("#packagePreviewMessage"),
      $gitPackagesList: $("#gitPackagesList"),
      $previewName: $("#previewName"),
      $previewMachineName: $("#previewMachineName"),
      $previewRemoteVersion: $("#previewRemoteVersion"),
      $previewLocalVersion: $("#previewLocalVersion"),
      $exitInstanceButton: $("#exitInstanceButton"),
      $workspace: $("body > .workspace"),
      $instanceLoading: $("#instanceLoading"),
      $instanceLoadingName: $("#instanceLoadingName"),
      $instanceLoadingProgress: $("#instanceLoadingProgress"),
      $instanceLoadingStatus: $("#instanceLoadingStatus"),
      // Manage Users modal
      $manageUsersModal: $("#manageUsersModal"),
      $closeManageUsersModal: $("#closeManageUsersModal"),
      $manageUsersInstanceName: $("#manageUsersInstanceName"),
      $addUserRoleForm: $("#addUserRoleForm"),
      $addUserSelect: $("#addUserSelect"),
      $addRoleSelect: $("#addRoleSelect"),
      $addUserMessage: $("#addUserMessage"),
      $instanceUsersList: $("#instanceUsersList"),
      // Delete Instance modal
      $deleteInstanceModal: $("#deleteInstanceModal"),
      $closeDeleteInstanceModal: $("#closeDeleteInstanceModal"),
      $deleteInstanceName: $("#deleteInstanceName"),
      $deleteInstanceConfirmInput: $("#deleteInstanceConfirmInput"),
      $deleteInstanceMessage: $("#deleteInstanceMessage"),
      $confirmDeleteInstanceButton: $("#confirmDeleteInstanceButton"),
      // Manage Roles
      $manageRolesButton: $("#manageRolesButton"),
      $manageRolesModal: $("#manageRolesModal"),
      $closeManageRolesModal: $("#closeManageRolesModal"),
      $roleForm: $("#roleForm"),
      $roleFormId: $("#roleFormId"),
      $roleNameInput: $("#roleNameInput"),
      $roleDescriptionInput: $("#roleDescriptionInput"),
      $rolePermissionsList: $("#rolePermissionsList"),
      $roleFormMessage: $("#roleFormMessage"),
      $roleFormSubmitButton: $("#roleFormSubmitButton"),
      $roleFormCancelButton: $("#roleFormCancelButton"),
      $rolesList: $("#rolesList"),
      // Manage Global Users
      $manageGlobalUsersButton: $("#manageGlobalUsersButton"),
      $manageGlobalUsersModal: $("#manageGlobalUsersModal"),
      $closeManageGlobalUsersModal: $("#closeManageGlobalUsersModal"),
      $globalUsersMessage: $("#globalUsersMessage"),
      $globalUsersList: $("#globalUsersList"),
    };
  }
  return elements;
}
