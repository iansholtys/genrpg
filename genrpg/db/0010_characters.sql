-- Created: 2026-05-17

CREATE TABLE IF NOT EXISTS genrpg.characters (
  guid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_guid uuid NOT NULL REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS characters_update_datetime ON genrpg.characters;
CREATE TRIGGER characters_update_datetime
  BEFORE UPDATE ON genrpg.characters
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
