class PackageEventRegistry {
  constructor() {
    this.eventsByName = new Map();
  }

  clear() {
    this.eventsByName.clear();
  }

  register(packageName, eventName, eventClass) {
    if (this.eventsByName.has(eventName)) {
      const existing = this.eventsByName.get(eventName);
      if (existing.packageName !== packageName) {
        throw new Error(
          `Event "${eventName}" is already registered by package "${existing.packageName}"`,
        );
      }
    }

    this.eventsByName.set(eventName, { packageName, eventClass });
  }

  getEventClass(eventName) {
    return this.eventsByName.get(eventName)?.eventClass || null;
  }
}

module.exports = { PackageEventRegistry };
