const {
  CharacterPreGetEvent,
  CharacterPostGetEvent,
  CharacterPreCreateEvent,
  CharacterPostCreateEvent,
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
  getEventDispatcher,
  refreshPackageSubscribers,
  invalidatePackageSubscribers,
};
