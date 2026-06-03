class ValidationError extends Error {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [String(errors)];
    super(list[0] || "Validation failed");
    this.name = "ValidationError";
    this.errors = list;
  }
}

module.exports = { ValidationError };
