const { BaseEvent } = require("../../src/events/BaseEvent");

class CharacterPreGetEvent extends BaseEvent {
  static eventName = "CharacterPreGetEvent";

  constructor({ characters, instanceGuid, instancePackageNames, user, pool }) {
    super();
    this.characters = characters;
    this.instanceGuid = instanceGuid;
    this.instancePackageNames = instancePackageNames;
    this.user = user;
    this.pool = pool;
  }
}

class CharacterPostGetEvent extends BaseEvent {
  static eventName = "CharacterPostGetEvent";

  constructor({ characters, instanceGuid, instancePackageNames, user, pool }) {
    super();
    this.characters = characters;
    this.instanceGuid = instanceGuid;
    this.instancePackageNames = instancePackageNames;
    this.user = user;
    this.pool = pool;
  }
}

class CharacterPreCreateEvent extends BaseEvent {
  static eventName = "CharacterPreCreateEvent";

  constructor({ payload, instanceGuid, instancePackageNames, user, pool }) {
    super();
    this.payload = payload;
    this.instanceGuid = instanceGuid;
    this.instancePackageNames = instancePackageNames;
    this.user = user;
    this.pool = pool;
  }
}

class CharacterPostCreateEvent extends BaseEvent {
  static eventName = "CharacterPostCreateEvent";

  constructor({
    characters,
    characterGuid,
    payload,
    instanceGuid,
    instancePackageNames,
    user,
    pool,
  }) {
    super();
    this.characters = characters;
    this.characterGuid = characterGuid;
    this.payload = payload;
    this.instanceGuid = instanceGuid;
    this.instancePackageNames = instancePackageNames;
    this.user = user;
    this.pool = pool;
  }
}

class CharacterPreUpdateEvent extends BaseEvent {
  static eventName = "CharacterPreUpdateEvent";

  constructor({ payload, characterGuid, instanceGuid, instancePackageNames, user, pool }) {
    super();
    this.payload = payload;
    this.characterGuid = characterGuid;
    this.instanceGuid = instanceGuid;
    this.instancePackageNames = instancePackageNames;
    this.user = user;
    this.pool = pool;
  }
}

class CharacterPostUpdateEvent extends BaseEvent {
  static eventName = "CharacterPostUpdateEvent";

  constructor({
    characters,
    characterGuid,
    payload,
    instanceGuid,
    instancePackageNames,
    user,
    pool,
  }) {
    super();
    this.characters = characters;
    this.characterGuid = characterGuid;
    this.payload = payload;
    this.instanceGuid = instanceGuid;
    this.instancePackageNames = instancePackageNames;
    this.user = user;
    this.pool = pool;
  }
}

class CharacterPreDeleteEvent extends BaseEvent {
  static eventName = "CharacterPreDeleteEvent";

  constructor({ characterGuid, instanceGuid, instancePackageNames, user, pool }) {
    super();
    this.characterGuid = characterGuid;
    this.instanceGuid = instanceGuid;
    this.instancePackageNames = instancePackageNames;
    this.user = user;
    this.pool = pool;
  }
}

class CharacterPostDeleteEvent extends BaseEvent {
  static eventName = "CharacterPostDeleteEvent";

  constructor({ characterGuid, instanceGuid, instancePackageNames, user, pool }) {
    super();
    this.characterGuid = characterGuid;
    this.instanceGuid = instanceGuid;
    this.instancePackageNames = instancePackageNames;
    this.user = user;
    this.pool = pool;
  }
}

module.exports = {
  CharacterPreGetEvent,
  CharacterPostGetEvent,
  CharacterPreCreateEvent,
  CharacterPostCreateEvent,
  CharacterPreUpdateEvent,
  CharacterPostUpdateEvent,
  CharacterPreDeleteEvent,
  CharacterPostDeleteEvent,
};
