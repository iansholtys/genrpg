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
