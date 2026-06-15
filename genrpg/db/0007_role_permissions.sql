-- Created: 2026-05-17

CREATE TABLE IF NOT EXISTS genrpg.role_permissions (
  role_id integer NOT NULL REFERENCES genrpg.roles(id) ON DELETE CASCADE,
  permission_id integer NOT NULL REFERENCES genrpg.permissions(id) ON DELETE CASCADE,
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

DROP TRIGGER IF EXISTS role_permissions_update_datetime ON genrpg.role_permissions;
CREATE TRIGGER role_permissions_update_datetime
  BEFORE UPDATE ON genrpg.role_permissions
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
