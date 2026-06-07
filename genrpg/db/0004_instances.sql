-- Created: 2026-05-16

CREATE TABLE IF NOT EXISTS genrpg.instances (
  guid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  packages text NOT NULL DEFAULT 'genrpg',
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS instances_update_datetime ON genrpg.instances;
CREATE TRIGGER instances_update_datetime
  BEFORE UPDATE ON genrpg.instances
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
