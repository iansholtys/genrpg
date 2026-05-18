-- Created: 2026-05-17

CREATE TABLE IF NOT EXISTS genrpg.item_templates (
  guid uuid PRIMARY KEY,
  instance_guid uuid NOT NULL REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  weight double precision,
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_templates_instance
  ON genrpg.item_templates(instance_guid);

DROP TRIGGER IF EXISTS item_templates_update_datetime ON genrpg.item_templates;
CREATE TRIGGER item_templates_update_datetime
  BEFORE UPDATE ON genrpg.item_templates
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
