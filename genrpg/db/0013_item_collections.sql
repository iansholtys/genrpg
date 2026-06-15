-- Created: 2026-05-26

CREATE TABLE IF NOT EXISTS genrpg.item_collections (
  guid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_guid uuid NOT NULL REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_collections_instance
  ON genrpg.item_collections(instance_guid);

DROP TRIGGER IF EXISTS item_collections_update_datetime ON genrpg.item_collections;
CREATE TRIGGER item_collections_update_datetime
  BEFORE UPDATE ON genrpg.item_collections
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
