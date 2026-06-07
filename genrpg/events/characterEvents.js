const { BaseEvent } = require("../../src/events/BaseEvent");

class CharacterPreGetEvent extends BaseEvent {
  static eventName = "CharacterPreGetEvent";

  constructor({ entities, instance }) {
    super();
    this.entities = entities;
    this.instance = instance;
  }
}

class CharacterPostGetEvent extends BaseEvent {
  static eventName = "CharacterPostGetEvent";

  constructor({ entities, instance }) {
    super();
    this.entities = entities;
    this.instance = instance;
  }
}

class CharacterPreCreateEvent extends BaseEvent {
  static eventName = "CharacterPreCreateEvent";

  constructor({ entity, instance }) {
    super();
    this.entity = entity;
    this.instance = instance;
  }
}

class CharacterPostCreateEvent extends BaseEvent {
  static eventName = "CharacterPostCreateEvent";

  constructor({ entity, instance }) {
    super();
    this.entity = entity;
    this.instance = instance;
  }
}

class CharacterPreUpdateEvent extends BaseEvent {
  static eventName = "CharacterPreUpdateEvent";

  constructor({ entity, instance }) {
    super();
    this.entity = entity;
    this.instance = instance;
  }
}

class CharacterPostUpdateEvent extends BaseEvent {
  static eventName = "CharacterPostUpdateEvent";

  constructor({ entity, instance }) {
    super();
    this.entity = entity;
    this.instance = instance;
  }
}

class CharacterPreDeleteEvent extends BaseEvent {
  static eventName = "CharacterPreDeleteEvent";

  constructor({ entity, instance }) {
    super();
    this.entity = entity;
    this.instance = instance;
  }
}

class CharacterPostDeleteEvent extends BaseEvent {
  static eventName = "CharacterPostDeleteEvent";

  constructor({ entity, instance }) {
    super();
    this.entity = entity;
    this.instance = instance;
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
