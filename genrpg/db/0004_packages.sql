-- Created: 2026-05-16

CREATE TABLE IF NOT EXISTS genrpg.packages (
  package text PRIMARY KEY,
  version integer NOT NULL DEFAULT 0,
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS packages_update_datetime ON genrpg.packages;
CREATE TRIGGER packages_update_datetime
  BEFORE UPDATE ON genrpg.packages
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
