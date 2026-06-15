-- Created: 2026-05-17

CREATE TABLE IF NOT EXISTS genrpg.roles (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS roles_update_datetime ON genrpg.roles;
CREATE TRIGGER roles_update_datetime
  BEFORE UPDATE ON genrpg.roles
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
