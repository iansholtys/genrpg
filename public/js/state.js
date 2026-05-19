export const state = {
  currentUser: null,
  instancesTable: null,
  activeInstance: null,
  enteringInstance: false,
  injectedStylesheets: [],
  injectedScripts: [],
  loadedInstanceScriptUrls: new Set(),
  packageNameByMachineName: new Map(),
  packageByMachineName: new Map(),
  manageUsersInstanceGuid: null,
  manageUsersInstanceName: null,
  allRoles: [],
};
