-- Created: 2026-05-16

CREATE OR REPLACE FUNCTION genrpg.set_update_datetime()
RETURNS trigger AS $$
BEGIN
  NEW.update_datetime = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
