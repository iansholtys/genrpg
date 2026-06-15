const { HttpError } = require("../errors/HttpError");
const { BadRequestError } = require("../errors/BadRequestError");
const { NotFoundError } = require("../errors/NotFoundError");
const { PermissionError } = require("../errors/PermissionError");
const { ValidationError } = require("../errors/ValidationError");

function sendHttpError(res, error) {
  if (error instanceof ValidationError) {
    res.status(400).json({ error: error.message, errors: error.errors });
    return true;
  }
  if (error instanceof BadRequestError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  if (error instanceof PermissionError) {
    res.status(403).json({ error: error.message });
    return true;
  }
  if (error instanceof NotFoundError) {
    res.status(404).json({ error: error.message });
    return true;
  }
  if (error instanceof HttpError) {
    const body = { error: error.message };
    if (error.details?.length) {
      body.details = error.details;
    }
    if (error.errors?.length) {
      body.errors = error.errors;
    }
    res.status(error.status).json(body);
    return true;
  }
  return false;
}

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      if (sendHttpError(res, error)) {
        return;
      }
      next(error);
    }
  };
}

module.exports = { asyncRoute };
