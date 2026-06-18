-- Created: 2026-06-04

CREATE TABLE IF NOT EXISTS genrpg.cache (
  cache_key text NOT NULL,
  instance_guid uuid REFERENCES genrpg.instances(guid) ON DELETE CASCADE,
  value jsonb NOT NULL,
  cached_datetime timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (cache_key, instance_guid)
);

CREATE INDEX IF NOT EXISTS idx_cache_instance ON genrpg.cache(instance_guid)
  WHERE instance_guid IS NOT NULL;

CREATE OR REPLACE FUNCTION genrpg.set_cached_datetime()
RETURNS trigger AS $$
BEGIN
  NEW.cached_datetime = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cache_cached_datetime ON genrpg.cache;
CREATE TRIGGER cache_cached_datetime
  BEFORE UPDATE ON genrpg.cache
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_cached_datetime();
