-- Created: 2026-05-16

CREATE TABLE IF NOT EXISTS instances (
  guid uuid PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS instances_update_datetime ON instances;
CREATE TRIGGER instances_update_datetime
  BEFORE UPDATE ON instances
  FOR EACH ROW EXECUTE FUNCTION set_update_datetime();
