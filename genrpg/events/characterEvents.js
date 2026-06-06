const { BaseEvent } = require("../../src/events/BaseEvent");

class CharacterPreGetEvent extends BaseEvent {
  static eventName = "CharacterPreGetEvent";

  constructor({ entities, instanceGuid }) {
    super();
    this.entities = entities;
    this.instanceGuid = instanceGuid;
  }
}

class CharacterPostGetEvent extends BaseEvent {
  static eventName = "CharacterPostGetEvent";

  constructor({ entities, instanceGuid }) {
    super();
    this.entities = entities;
    this.instanceGuid = instanceGuid;
  }
}

class CharacterPreCreateEvent extends BaseEvent {
  static eventName = "CharacterPreCreateEvent";

  constructor({ entity, instanceGuid }) {
    super();
    this.entity = entity;
    this.instanceGuid = instanceGuid;
  }
}

class CharacterPostCreateEvent extends BaseEvent {
  static eventName = "CharacterPostCreateEvent";

  constructor({ entity, instanceGuid }) {
    super();
    this.entity = entity;
    this.instanceGuid = instanceGuid;
  }
}

class CharacterPreUpdateEvent extends BaseEvent {
  static eventName = "CharacterPreUpdateEvent";

  constructor({ entity, instanceGuid }) {
    super();
    this.entity = entity;
    this.instanceGuid = instanceGuid;
  }
}

class CharacterPostUpdateEvent extends BaseEvent {
  static eventName = "CharacterPostUpdateEvent";

  constructor({ entity, instanceGuid }) {
    super();
    this.entity = entity;
    this.instanceGuid = instanceGuid;
  }
}

class CharacterPreDeleteEvent extends BaseEvent {
  static eventName = "CharacterPreDeleteEvent";

  constructor({ entity, instanceGuid }) {
    super();
    this.entity = entity;
    this.instanceGuid = instanceGuid;
  }
}

class CharacterPostDeleteEvent extends BaseEvent {
  static eventName = "CharacterPostDeleteEvent";

  constructor({ entity, instanceGuid }) {
    super();
    this.entity = entity;
    this.instanceGuid = instanceGuid;
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
