const express = require("express");
const usersRouter = require("./users");
const rolesRouter = require("./roles");
const packagesRouter = require("./packages");
const instancesRouter = require("./instances");
const itemTemplatesRouter = require("./itemTemplates");
const itemsRouter = require("./items");
const itemCollectionsRouter = require("./itemCollections");
const charactersRouter = require("./characters");
const aliasesRouter = require("./aliases");
const cacheRouter = require("./cache");

const genrpgApi = express.Router();

genrpgApi.use(usersRouter);
genrpgApi.use(rolesRouter);
genrpgApi.use(packagesRouter);
genrpgApi.use(instancesRouter);
genrpgApi.use(itemTemplatesRouter);
genrpgApi.use(itemsRouter);
genrpgApi.use(itemCollectionsRouter);
genrpgApi.use(charactersRouter);
genrpgApi.use(aliasesRouter);
genrpgApi.use(cacheRouter);

module.exports = genrpgApi;
