class BaseEvent {
  constructor() {
    this._propagationStopped = false;
    this.errors = [];
  }

  stopPropagation() {
    this._propagationStopped = true;
  }

  isPropagationStopped() {
    return this._propagationStopped;
  }

  addError(message) {
    if (typeof message === "string" && message.trim()) {
      this.errors.push(message.trim());
    }
  }
}

module.exports = { BaseEvent };
