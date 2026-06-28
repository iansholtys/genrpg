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
  // Return the cached dispatcher when subscribers are already loaded and reload was not requested.
  if (subscribersLoaded && !force) {
    return dispatcher;
  }

  // Drop all event-to-handler and event-name ownership mappings from the previous load.
  subscriberRegistry.clear();
  eventOwnersByName.clear();

  // Load installed packages and look up and validate their events and subscribers.
  const packages = await loadPackages({ strict: false });
  for (const pkg of packages) {
    const { path, machineName } = pkg;
    const packageDir = packageRootDir(path);
    const manifestFileName = `${machineName}.events.yml`;

    // Read the package's events manifest and validate its contents.
    const manifest = await readPackageEventsManifest(packageDir, manifestFileName);
    if (!manifest) {
      continue;
    }

    // Validate declared event classes and record which package owns each name.
    const eventModulesByPath = new Map();
    for (const eventEntry of manifest.events) {
      // Reuse already-required modules when several events share one file.
      const { module, name } = eventEntry;
      let eventModule = eventModulesByPath.get(module);
      if (!eventModule) {
        const modulePath = resolvePackageModule(packageDir, module, manifestFileName, "events.module");
        delete require.cache[require.resolve(modulePath)];
        eventModule = require(modulePath);
        eventModulesByPath.set(module, eventModule);
      }

      // Resolve the export named in the manifest (named export, default export, or the module itself).
      const EventClass =
        (eventModule && eventModule[name]) ||
        (typeof eventModule === "function" &&
        (eventModule.eventName === name || eventModule.name === name)
          ? eventModule
          : null);

      if (!EventClass || typeof EventClass !== "function") {
        throw new PackageLoadError("Invalid package configuration", [
          `Package "${machineName}" event module must export "${name}"`,
        ]);
      }

      // Record which package owns this event name; reject duplicate declarations.
      const existingOwner = eventOwnersByName.get(name);
      if (existingOwner && existingOwner !== machineName) {
        throw new Error(
          `Event "${name}" is already registered by package "${existingOwner}"`,
        );
      }
      eventOwnersByName.set(name, machineName);
    }

    // load subscribers and wire event name -> handler into the registry.
    for (const subscriberEntry of manifest.subscribers) {
      const { module, listens } = subscriberEntry;
      const modulePath = resolvePackageModule(packageDir, module, manifestFileName, "subscribers.module");
      delete require.cache[require.resolve(modulePath)];
      const subscriberModule = require(modulePath);

      // Accept a class export, default export, or `.Subscriber` named export.
      const SubscriberClass =
        (typeof subscriberModule === "function" && subscriberModule) ||
        (typeof subscriberModule?.default === "function" && subscriberModule.default) ||
        (typeof subscriberModule?.Subscriber === "function" && subscriberModule.Subscriber) ||
        null;

      if (!SubscriberClass) {
        throw new PackageLoadError("Invalid package configuration", [
          `Package "${machineName}" subscriber module must export a subscriber class`,
        ]);
      }

      // Instantiate when possible; otherwise use the export as a singleton/factory.
      let subscriber;
      try {
        subscriber = new SubscriberClass();
      } catch {
        subscriber = SubscriberClass;
      }

      // Wire handlers from manifest `listens`, or fall back to getSubscribedEvents() below.
      if (Array.isArray(listens) && listens.length) {
        for (const binding of listens) {
          const { event, method, priority } = binding;
          if (typeof subscriber[method] !== "function") {
            throw new PackageLoadError("Invalid package configuration", [
              `Package "${machineName}" subscriber is missing method "${method}" for ${event}`,
            ]);
          }
          subscriberRegistry.addListener(event, machineName, method, subscriber, priority);
        }
        continue;
      }

      // Fallback: subscriber class exposes getSubscribedEvents() instead of manifest bindings.
      subscriberRegistry.addSubscriber(machineName, subscriber);
    }
  }

  // Mark load complete so subsequent calls return the cached dispatcher.
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
