const { HttpError } = require("./HttpError");

class PackageLoadError extends HttpError {
  constructor(message, details = []) {
    super(500, message, details.length ? details : null);
    this.name = "PackageLoadError";
  }
}

module.exports = { PackageLoadError };
