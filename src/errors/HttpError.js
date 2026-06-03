class HttpError extends Error {
  constructor(status, message, details = null, errors = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
    this.errors = errors;
  }
}

module.exports = { HttpError };
