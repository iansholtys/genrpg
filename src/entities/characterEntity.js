const { pool } = require("../db/pool");
const { ValidationError } = require("../errors/ValidationError");
const {
  CharacterPreCreateEvent,
  CharacterPostCreateEvent,
  CharacterPreUpdateEvent,
  CharacterPostUpdateEvent,
  CharacterPreDeleteEvent,
  CharacterPostDeleteEvent,
  CharacterPreGetEvent,
  CharacterPostGetEvent,
} = require("../../genrpg/events/characterEvents");
const { getEventDispatcher } = require("../events/packageEvents");
const {
  expandPackageSelectionForAssets,
  loadPackages,
  parsePackageCsv,
} = require("../packages");
const CharacterStorage = require("../storage/characterStorage");

const INSTANCE_FIELDS = ["guid", "packages"];

async function resolveInstancePackageNames(instancePackages) {
  const { packages } = await loadPackages({ strict: true });
  return expandPackageSelectionForAssets(parsePackageCsv(instancePackages), packages);
}

function buildCharacterDispatchContext(instanceGuid, packageNames, user) {
  return {
    instanceGuid,
    instancePackageNames: packageNames,
    user,
    pool,
  };
}

async function dispatchCharacterGetEvents(characters, context) {
  const dispatcher = await getEventDispatcher();
  const packageNames = context.instancePackageNames;
  const eventContext = {
    characters,
    instanceGuid: context.instanceGuid,
    instancePackageNames: packageNames,
    user: context.user,
    pool,
  };

  const pre = new CharacterPreGetEvent(eventContext);
  await dispatcher.dispatch(pre, packageNames);

  const post = new CharacterPostGetEvent({
    ...eventContext,
    characters: pre.characters,
  });
  await dispatcher.dispatch(post, packageNames);
  return post.characters;
}

function throwEventErrors(event) {
  if (event.errors.length) {
    throw new ValidationError(event.errors);
  }
}

class CharacterEntity {
  static getStorage() {
    return require("../storage/characterStorage");
  }

  static async resolvePackageNames(context) {
    return resolveInstancePackageNames(context.instance.packages);
  }

  static buildDispatchContext(context, packageNames) {
    return buildCharacterDispatchContext(context.instanceGuid, packageNames, context.user);
  }

  static async getFormSchema(context) {
    const packageNames = await CharacterEntity.resolvePackageNames(context);
    return CharacterStorage.loadFormMetadata(packageNames);
  }

  static async list(context) {
    const packageNames = await CharacterEntity.resolvePackageNames(context);
    const storage = CharacterStorage.forInstance(context.instanceGuid);
    let characters = await storage.list(packageNames);
    return dispatchCharacterGetEvents(
      characters,
      CharacterEntity.buildDispatchContext(context, packageNames),
    );
  }

  static async load(context, id) {
    const packageNames = await CharacterEntity.resolvePackageNames(context);
    const storage = CharacterStorage.forInstance(context.instanceGuid);
    let characters = await storage.list(packageNames, id);
    if (!characters.length) {
      return null;
    }

    characters = await dispatchCharacterGetEvents(
      characters,
      CharacterEntity.buildDispatchContext(context, packageNames),
    );

    if (!characters.length) {
      return null;
    }

    return characters[0];
  }

  static async create(context, input) {
    const packageNames = await CharacterEntity.resolvePackageNames(context);
    const storage = CharacterStorage.forInstance(context.instanceGuid);
    const dispatcher = await getEventDispatcher();
    const dispatchContext = CharacterEntity.buildDispatchContext(context, packageNames);

    const pre = new CharacterPreCreateEvent({
      ...dispatchContext,
      payload: input,
    });
    await dispatcher.dispatch(pre, packageNames);
    throwEventErrors(pre);

    const characterGuid = await storage.create(context.user.guid, packageNames, pre.payload);
    let characters = await storage.list(packageNames, characterGuid);

    const post = new CharacterPostCreateEvent({
      ...dispatchContext,
      characters,
      characterGuid,
      payload: pre.payload,
    });
    await dispatcher.dispatch(post, packageNames);
    characters = await storage.list(packageNames, characterGuid);
    characters = await dispatchCharacterGetEvents(characters, dispatchContext);
    return characters[0];
  }

  static async update(context, id, input) {
    const storage = CharacterStorage.forInstance(context.instanceGuid);
    if (!(await storage.exists(id))) {
      return null;
    }

    const packageNames = await CharacterEntity.resolvePackageNames(context);
    const dispatcher = await getEventDispatcher();
    const dispatchContext = CharacterEntity.buildDispatchContext(context, packageNames);

    const pre = new CharacterPreUpdateEvent({
      ...dispatchContext,
      characterGuid: id,
      payload: input,
    });
    await dispatcher.dispatch(pre, packageNames);
    throwEventErrors(pre);

    await storage.update(id, packageNames, pre.payload);
    let characters = await storage.list(packageNames, id);

    const post = new CharacterPostUpdateEvent({
      ...dispatchContext,
      characters,
      characterGuid: id,
      payload: pre.payload,
    });
    await dispatcher.dispatch(post, packageNames);
    characters = await storage.list(packageNames, id);
    characters = await dispatchCharacterGetEvents(characters, dispatchContext);
    return characters[0];
  }

  static async delete(context, id) {
    const storage = CharacterStorage.forInstance(context.instanceGuid);
    if (!(await storage.exists(id))) {
      return false;
    }

    const packageNames = await CharacterEntity.resolvePackageNames(context);
    const dispatcher = await getEventDispatcher();
    const dispatchContext = CharacterEntity.buildDispatchContext(context, packageNames);

    const pre = new CharacterPreDeleteEvent({
      ...dispatchContext,
      characterGuid: id,
    });
    await dispatcher.dispatch(pre, packageNames);
    throwEventErrors(pre);

    const deleted = await storage.delete(id, packageNames);
    if (!deleted) {
      return false;
    }

    const post = new CharacterPostDeleteEvent({
      ...dispatchContext,
      characterGuid: id,
    });
    await dispatcher.dispatch(post, packageNames);
    return true;
  }
}

module.exports = {
  CharacterEntity,
  INSTANCE_FIELDS,
};
