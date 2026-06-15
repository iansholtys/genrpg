-- Created: 2026-05-17

CREATE TABLE IF NOT EXISTS genrpg.item_templates (
  guid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_guid uuid NOT NULL REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_templates_instance
  ON genrpg.item_templates(instance_guid);

DROP TRIGGER IF EXISTS item_templates_update_datetime ON genrpg.item_templates;
CREATE TRIGGER item_templates_update_datetime
  BEFORE UPDATE ON genrpg.item_templates
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();

CREATE TABLE IF NOT EXISTS genrpg.items (
  guid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_guid uuid NOT NULL REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_items_instance
  ON genrpg.items(instance_guid);

DROP TRIGGER IF EXISTS items_update_datetime ON genrpg.items;
CREATE TRIGGER items_update_datetime
  BEFORE UPDATE ON genrpg.items
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
