-- Created: 2026-05-16

CREATE TABLE IF NOT EXISTS genrpg.users (
  guid uuid PRIMARY KEY,
  oidc_issuer text NOT NULL,
  oidc_subject text NOT NULL,
  email text,
  display_name text,
  admin boolean NOT NULL DEFAULT false,
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oidc_issuer, oidc_subject)
);

DROP TRIGGER IF EXISTS users_update_datetime ON genrpg.users;
CREATE TRIGGER users_update_datetime
  BEFORE UPDATE ON genrpg.users
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
