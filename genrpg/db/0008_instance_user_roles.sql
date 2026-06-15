-- Created: 2026-05-17

CREATE TABLE IF NOT EXISTS genrpg.instance_user_roles (
  instance_guid uuid NOT NULL REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
  user_guid uuid NOT NULL REFERENCES genrpg.users(guid) ON DELETE CASCADE,
  role_id integer NOT NULL REFERENCES genrpg.roles(id) ON DELETE CASCADE,
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_guid, user_guid)
);

CREATE INDEX IF NOT EXISTS idx_instance_user_roles_user
  ON genrpg.instance_user_roles(user_guid);

DROP TRIGGER IF EXISTS instance_user_roles_update_datetime ON genrpg.instance_user_roles;
CREATE TRIGGER instance_user_roles_update_datetime
  BEFORE UPDATE ON genrpg.instance_user_roles
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
