const {
  CharacterPreGetEvent,
  CharacterPostGetEvent,
  CharacterPreCreateEvent,
  CharacterPostCreateEvent,
  CharacterPreUpdateEvent,
  CharacterPostUpdateEvent,
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
  getEventDispatcher,
  refreshPackageSubscribers,
  invalidatePackageSubscribers,
};
