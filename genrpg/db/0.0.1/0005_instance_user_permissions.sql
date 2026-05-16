-- Created: 2026-05-16

CREATE TABLE IF NOT EXISTS instance_user_permissions (
  instance_guid uuid NOT NULL REFERENCES instances(guid) ON DELETE CASCADE,
  user_guid uuid NOT NULL REFERENCES users(guid) ON DELETE CASCADE,
  permission text NOT NULL CHECK (permission IN ('Owner', 'Editor', 'Viewer')),
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_guid, user_guid)
);

CREATE INDEX IF NOT EXISTS idx_instance_user_permissions_user
  ON instance_user_permissions(user_guid);

DROP TRIGGER IF EXISTS instance_user_permissions_update_datetime ON instance_user_permissions;
CREATE TRIGGER instance_user_permissions_update_datetime
  BEFORE UPDATE ON instance_user_permissions
  FOR EACH ROW EXECUTE FUNCTION set_update_datetime();
