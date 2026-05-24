class SubscriberRegistry {
  constructor() {
    this.listenersByEvent = new Map();
  }

  clear() {
    this.listenersByEvent.clear();
  }

  addListener(eventName, packageName, method, subscriber, priority = 0) {
    if (!this.listenersByEvent.has(eventName)) {
      this.listenersByEvent.set(eventName, []);
    }

    this.listenersByEvent.get(eventName).push({
      eventName,
      packageName,
      method,
      subscriber,
      priority,
    });
  }

  addSubscriber(packageName, subscriber) {
    const subscribed =
      subscriber.getSubscribedEvents?.() ||
      subscriber.constructor?.getSubscribedEvents?.();
    if (!subscribed || typeof subscribed !== "object") {
      return;
    }

    for (const [eventName, definition] of Object.entries(subscribed)) {
      const entries = Array.isArray(definition) ? definition : [definition];
      for (const entry of entries) {
        let method = entry;
        let priority = 0;

        if (Array.isArray(entry)) {
          [method, priority = 0] = entry;
        }

        if (typeof method !== "string" || typeof subscriber[method] !== "function") {
          throw new Error(
            `Package "${packageName}" subscriber is missing method "${method}" for ${eventName}`,
          );
        }

        this.addListener(eventName, packageName, method, subscriber, priority);
      }
    }
  }

  getListeners(eventName) {
    const listeners = this.listenersByEvent.get(eventName) || [];
    return [...listeners].sort((a, b) => b.priority - a.priority);
  }
}

module.exports = { SubscriberRegistry };
