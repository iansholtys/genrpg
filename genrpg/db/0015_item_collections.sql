-- Created: 2026-05-26

CREATE TABLE IF NOT EXISTS genrpg.item_collections (
  guid uuid PRIMARY KEY,
  instance_guid uuid NOT NULL REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
  type text NOT NULL,
  name text,
  item_guid uuid REFERENCES genrpg.items(guid) ON DELETE SET NULL,
  capacity_used double precision,
  capacity_max double precision,
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_collections_instance
  ON genrpg.item_collections(instance_guid);

CREATE INDEX IF NOT EXISTS idx_item_collections_item
  ON genrpg.item_collections(item_guid);

DROP TRIGGER IF EXISTS item_collections_update_datetime ON genrpg.item_collections;
CREATE TRIGGER item_collections_update_datetime
  BEFORE UPDATE ON genrpg.item_collections
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();

CREATE TABLE IF NOT EXISTS genrpg.item_collection_contents (
  guid uuid PRIMARY KEY,
  instance_guid uuid NOT NULL REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
  collection_guid uuid NOT NULL REFERENCES genrpg.item_collections(guid) ON DELETE CASCADE,
  item_guid uuid REFERENCES genrpg.items(guid) ON DELETE CASCADE,
  subcollection_guid uuid REFERENCES genrpg.item_collections(guid) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1,
  position integer NOT NULL DEFAULT 0,
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (item_guid IS NOT NULL AND subcollection_guid IS NULL)
    OR (item_guid IS NULL AND subcollection_guid IS NOT NULL)
  ),
  CHECK (quantity >= 0)
);

CREATE INDEX IF NOT EXISTS idx_item_collection_contents_collection
  ON genrpg.item_collection_contents(collection_guid);

CREATE INDEX IF NOT EXISTS idx_item_collection_contents_item
  ON genrpg.item_collection_contents(item_guid);

CREATE INDEX IF NOT EXISTS idx_item_collection_contents_subcollection
  ON genrpg.item_collection_contents(subcollection_guid);

CREATE INDEX IF NOT EXISTS idx_item_collection_contents_collection_position
  ON genrpg.item_collection_contents(collection_guid, position);

DROP TRIGGER IF EXISTS item_collection_contents_update_datetime ON genrpg.item_collection_contents;
CREATE TRIGGER item_collection_contents_update_datetime
  BEFORE UPDATE ON genrpg.item_collection_contents
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();

CREATE TABLE IF NOT EXISTS genrpg.inventories (
  guid uuid PRIMARY KEY,
  instance_guid uuid NOT NULL REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
  collection_guid uuid NOT NULL REFERENCES genrpg.item_collections(guid) ON DELETE CASCADE,
  character_guid uuid NOT NULL REFERENCES genrpg.characters(guid) ON DELETE CASCADE,
  create_datetime timestamptz NOT NULL DEFAULT now(),
  update_datetime timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventories_instance
  ON genrpg.inventories(instance_guid);

CREATE INDEX IF NOT EXISTS idx_inventories_character
  ON genrpg.inventories(character_guid);

CREATE INDEX IF NOT EXISTS idx_inventories_collection
  ON genrpg.inventories(collection_guid);

DROP TRIGGER IF EXISTS inventories_update_datetime ON genrpg.inventories;
CREATE TRIGGER inventories_update_datetime
  BEFORE UPDATE ON genrpg.inventories
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_update_datetime();
