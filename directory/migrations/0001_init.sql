-- Schema des Freunde-Verzeichnisses (docs/friends/BYNAME.md, Abschnitt 5.1).
CREATE TABLE users (
  uuid TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  refreshed_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE letters (
  id TEXT PRIMARY KEY,
  to_uuid TEXT NOT NULL,
  from_uuid TEXT NOT NULL,
  from_name TEXT NOT NULL,
  from_peer TEXT NOT NULL,
  body TEXT NOT NULL, -- die signierten Felder als JSON
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (to_uuid, from_uuid)
);
CREATE INDEX letters_from ON letters(from_uuid);
CREATE INDEX letters_expiry ON letters(expires_at);

CREATE TABLE blocks (
  owner_uuid TEXT NOT NULL,
  blocked_uuid TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_uuid, blocked_uuid)
) WITHOUT ROWID;

CREATE TABLE sends (
  from_uuid TEXT NOT NULL,
  to_uuid TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX sends_from ON sends(from_uuid, at);
CREATE INDEX sends_pair ON sends(from_uuid, to_uuid, at);
