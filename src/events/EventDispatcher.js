function resolveEventName(event) {
  return event.constructor.eventName || event.constructor.name;
}

class EventDispatcher {
  constructor(registry) {
    this.registry = registry;
  }

  async dispatch(event, instancePackageNames) {
    const eventName = resolveEventName(event);
    const allowed = new Set(instancePackageNames);
    const listeners = this.registry.getListeners(eventName);

    for (const listener of listeners) {
      if (!allowed.has(listener.packageName)) {
        continue;
      }

      await listener.subscriber[listener.method](event);

      if (event.isPropagationStopped()) {
        break;
      }
    }

    return event;
  }
}

module.exports = { EventDispatcher };
