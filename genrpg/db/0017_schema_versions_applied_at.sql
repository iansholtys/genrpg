-- Created: 2026-06-08

CREATE OR REPLACE FUNCTION genrpg.set_applied_at()
RETURNS trigger AS $$
BEGIN
  NEW.applied_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS schema_versions_applied_at ON schema_versions;
CREATE TRIGGER schema_versions_applied_at
  BEFORE UPDATE ON schema_versions
  FOR EACH ROW EXECUTE FUNCTION genrpg.set_applied_at();
