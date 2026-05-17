-- Created: 2026-05-16

CREATE TABLE IF NOT EXISTS genrpg.session (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL,
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_expire ON genrpg.session(expire);

DROP TRIGGER IF EXISTS session_update_datetime ON genrpg.session;
CREATE TRIGGER session_update_datetime
  BEFORE UPDATE ON genrpg.session
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
