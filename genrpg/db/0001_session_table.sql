-- Created: 2026-05-16

CREATE TABLE IF NOT EXISTS genrpg.session (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_expire ON genrpg.session(expire);
