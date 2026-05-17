const express = require("express");
const usersRouter = require("./users");
const rolesRouter = require("./roles");
const packagesRouter = require("./packages");
const instancesRouter = require("./instances");

const genrpgApi = express.Router();

genrpgApi.use(usersRouter);
genrpgApi.use(rolesRouter);
genrpgApi.use(packagesRouter);
genrpgApi.use(instancesRouter);

module.exports = genrpgApi;
