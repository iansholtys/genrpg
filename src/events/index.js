const {
  CharacterPreGetEvent,
  CharacterPostGetEvent,
  CharacterPreCreateEvent,
  CharacterPostCreateEvent,
  CharacterPreUpdateEvent,
  CharacterPostUpdateEvent,
  CharacterPreDeleteEvent,
  CharacterPostDeleteEvent,
} = require("../../genrpg/events/characterEvents");
const {
  getEventDispatcher,
  refreshPackageSubscribers,
  invalidatePackageSubscribers,
} = require("./packageEvents");

module.exports = {
  CharacterPreGetEvent,
  CharacterPostGetEvent,
  CharacterPreCreateEvent,
  CharacterPostCreateEvent,
  CharacterPreUpdateEvent,
  CharacterPostUpdateEvent,
  CharacterPreDeleteEvent,
  CharacterPostDeleteEvent,
  getEventDispatcher,
  refreshPackageSubscribers,
  invalidatePackageSubscribers,
};
