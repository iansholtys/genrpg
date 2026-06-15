const { PackageLoadError, packageRootDir, loadPackages } = require("../packages");
const { SubscriberRegistry } = require("./SubscriberRegistry");
const { EventDispatcher } = require("./EventDispatcher");
const { PackageEventRegistry } = require("./PackageEventRegistry");
const {
  readPackageEventsManifest,
  resolvePackageModule,
} = require("./packageEventsManifest");

const subscriberRegistry = new SubscriberRegistry();
const packageEventRegistry = new PackageEventRegistry();
const dispatcher = new EventDispatcher(subscriberRegistry);
let subscribersLoaded = false;

function loadSubscriberClass(moduleExports) {
  if (typeof moduleExports === "function") {
    return moduleExports;
  }

  if (moduleExports?.default && typeof moduleExports.default === "function") {
    return moduleExports.default;
  }

  if (moduleExports?.Subscriber && typeof moduleExports.Subscriber === "function") {
    return moduleExports.Subscriber;
  }

  return null;
}

function instantiateSubscriber(SubscriberClass) {
  try {
    return new SubscriberClass();
  } catch {
    return SubscriberClass;
  }
}

function registerSubscriberModule(registry, packageName, moduleExports, listens) {
  const SubscriberClass = loadSubscriberClass(moduleExports);
  if (!SubscriberClass) {
    throw new PackageLoadError("Invalid package configuration", [
      `Package "${packageName}" subscriber module must export a subscriber class`,
    ]);
  }

  const subscriber = instantiateSubscriber(SubscriberClass);

  if (Array.isArray(listens) && listens.length) {
    for (const binding of listens) {
      if (typeof subscriber[binding.method] !== "function") {
        throw new PackageLoadError("Invalid package configuration", [
          `Package "${packageName}" subscriber is missing method "${binding.method}" for ${binding.event}`,
        ]);
      }
      registry.addListener(
        binding.event,
        packageName,
        binding.method,
        subscriber,
        binding.priority,
      );
    }
    return;
  }

  registry.addSubscriber(packageName, subscriber);
}

function registerDeclaredEvent(packageEventRegistry, packageName, moduleExports, eventName) {
  const EventClass =
    (moduleExports && moduleExports[eventName]) ||
    (typeof moduleExports === "function" &&
    (moduleExports.eventName === eventName || moduleExports.name === eventName)
      ? moduleExports
      : null);

  if (!EventClass || typeof EventClass !== "function") {
    throw new PackageLoadError("Invalid package configuration", [
      `Package "${packageName}" event module must export "${eventName}"`,
    ]);
  }

  packageEventRegistry.register(packageName, eventName, EventClass);
}

async function refreshPackageSubscribers({ force = false } = {}) {
  if (subscribersLoaded && !force) {
    return dispatcher;
  }

  subscriberRegistry.clear();
  packageEventRegistry.clear();
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

      registerDeclaredEvent(
        packageEventRegistry,
        pkg.machineName,
        eventModule,
        eventEntry.name,
      );
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
      registerSubscriberModule(
        subscriberRegistry,
        pkg.machineName,
        subscriberModule,
        subscriberEntry.listens,
      );
    }
  }

  subscribersLoaded = true;
  return dispatcher;
}

function invalidatePackageSubscribers() {
  subscribersLoaded = false;
}

async function getEventDispatcher() {
  return refreshPackageSubscribers();
}

module.exports = {
  getEventDispatcher,
  refreshPackageSubscribers,
  invalidatePackageSubscribers,
};
