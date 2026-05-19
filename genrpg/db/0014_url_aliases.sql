-- Created: 2026-05-19

CREATE TABLE IF NOT EXISTS genrpg.url_aliases (
  guid uuid PRIMARY KEY,
  alias text NOT NULL UNIQUE,
  path text NOT NULL,
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_url_aliases_path ON genrpg.url_aliases(path);

DROP TRIGGER IF EXISTS url_aliases_update_datetime ON genrpg.url_aliases;
CREATE TRIGGER url_aliases_update_datetime
  BEFORE UPDATE ON genrpg.url_aliases
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
