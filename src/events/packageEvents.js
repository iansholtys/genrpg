const { PackageLoadError, packageRootDir, loadPackages } = require("../packages");
const {
  readPackageEventsManifest,
  resolvePackageModule,
} = require("./packageEventsManifest");

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

class EventDispatcher {
  constructor(registry) {
    this.registry = registry;
  }

  async dispatch(event, instancePackageNames) {
    const eventName = event.constructor.eventName || event.constructor.name;
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

const subscriberRegistry = new SubscriberRegistry();
/** @type {Map<string, string>} eventName -> owning package machine name */
const eventOwnersByName = new Map();
const dispatcher = new EventDispatcher(subscriberRegistry);
let subscribersLoaded = false;

async function refreshPackageSubscribers({ force = false } = {}) {
  if (subscribersLoaded && !force) {
    return dispatcher;
  }

  subscriberRegistry.clear();
  eventOwnersByName.clear();
  const packages = await loadPackages({ strict: false });

  for (const pkg of packages) {
    const packageDir = packageRootDir(pkg.path);
    const manifest = await readPackageEventsManifest(packageDir, pkg.machineName);
    if (!manifest) {
      continue;
    }

    const label = `${pkg.machineName}.events.yml`;

    const eventModulesByPath = new Map();
    for (const eventEntry of manifest.events) {
      let eventModule = eventModulesByPath.get(eventEntry.module);
      if (!eventModule) {
        const modulePath = resolvePackageModule(packageDir, eventEntry.module, label, "events.module");
        delete require.cache[require.resolve(modulePath)];
        eventModule = require(modulePath);
        eventModulesByPath.set(eventEntry.module, eventModule);
      }

      const EventClass =
        (eventModule && eventModule[eventEntry.name]) ||
        (typeof eventModule === "function" &&
        (eventModule.eventName === eventEntry.name || eventModule.name === eventEntry.name)
          ? eventModule
          : null);

      if (!EventClass || typeof EventClass !== "function") {
        throw new PackageLoadError("Invalid package configuration", [
          `Package "${pkg.machineName}" event module must export "${eventEntry.name}"`,
        ]);
      }

      const existingOwner = eventOwnersByName.get(eventEntry.name);
      if (existingOwner && existingOwner !== pkg.machineName) {
        throw new Error(
          `Event "${eventEntry.name}" is already registered by package "${existingOwner}"`,
        );
      }
      eventOwnersByName.set(eventEntry.name, pkg.machineName);
    }

    for (const subscriberEntry of manifest.subscribers) {
      const modulePath = resolvePackageModule(
        packageDir,
        subscriberEntry.module,
        label,
        "subscribers.module",
      );
      delete require.cache[require.resolve(modulePath)];
      const subscriberModule = require(modulePath);

      const SubscriberClass =
        (typeof subscriberModule === "function" && subscriberModule) ||
        (typeof subscriberModule?.default === "function" && subscriberModule.default) ||
        (typeof subscriberModule?.Subscriber === "function" && subscriberModule.Subscriber) ||
        null;

      if (!SubscriberClass) {
        throw new PackageLoadError("Invalid package configuration", [
          `Package "${pkg.machineName}" subscriber module must export a subscriber class`,
        ]);
      }

      let subscriber;
      try {
        subscriber = new SubscriberClass();
      } catch {
        subscriber = SubscriberClass;
      }

      if (Array.isArray(subscriberEntry.listens) && subscriberEntry.listens.length) {
        for (const binding of subscriberEntry.listens) {
          if (typeof subscriber[binding.method] !== "function") {
            throw new PackageLoadError("Invalid package configuration", [
              `Package "${pkg.machineName}" subscriber is missing method "${binding.method}" for ${binding.event}`,
            ]);
          }
          subscriberRegistry.addListener(
            binding.event,
            pkg.machineName,
            binding.method,
            subscriber,
            binding.priority,
          );
        }
        continue;
      }

      subscriberRegistry.addSubscriber(pkg.machineName, subscriber);
    }
  }

  subscribersLoaded = true;
  return dispatcher;
}

function invalidatePackageSubscribers() {
  subscribersLoaded = false;
}

module.exports = {
  refreshPackageSubscribers,
  invalidatePackageSubscribers,
};
