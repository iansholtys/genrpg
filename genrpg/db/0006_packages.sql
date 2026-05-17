-- Created: 2026-05-16

CREATE TABLE IF NOT EXISTS genrpg.packages (
  package text PRIMARY KEY,
  version integer NOT NULL DEFAULT 0
);
