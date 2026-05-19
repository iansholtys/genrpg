export const state = {
  currentUser: null,
  activeInstance: null,
  enteringInstance: false,
  routeToken: 0,
  injectedStylesheets: [],
  injectedScripts: [],
  loadedInstanceScriptUrls: new Set(),
  packageNameByMachineName: new Map(),
  packageByMachineName: new Map(),
  allRoles: [],
};
