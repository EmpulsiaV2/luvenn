-- luvenn database schema (Postgres / Neon)
-- Plain accounts, no roles. Anyone can register and publish.

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  username        VARCHAR(32) UNIQUE NOT NULL,
  username_lower  VARCHAR(32) UNIQUE NOT NULL,
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  is_banned       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scripts (
  id              SERIAL PRIMARY KEY,
  public_id       VARCHAR(32) UNIQUE NOT NULL,      -- 32-char hex loader id, e.g. /files/v3/loaders/<public_id>.lua
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(80) NOT NULL,
  description     VARCHAR(500) DEFAULT '',
  game_name       VARCHAR(100) DEFAULT '',
  game_id         VARCHAR(40) DEFAULT '',
  category        VARCHAR(40) DEFAULT 'other',
  code            TEXT NOT NULL,                     -- original source, never shown publicly; only the owner sees it, in their own edit form
  protected_code  TEXT NOT NULL,                     -- obfuscated output actually served to executors
  version         VARCHAR(20) NOT NULL DEFAULT '0.0.1',
  has_key_system  BOOLEAN NOT NULL DEFAULT FALSE,
  key_link        VARCHAR(300) DEFAULT '',
  status          VARCHAR(20) NOT NULL DEFAULT 'published', -- published | pending | removed
  views           INTEGER NOT NULL DEFAULT 0,
  fetches         INTEGER NOT NULL DEFAULT 0,        -- successful executor loads
  blocked_attempts INTEGER NOT NULL DEFAULT 0,        -- browser UAs turned away at the loader endpoint
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scripts_user      ON scripts(user_id);
CREATE INDEX IF NOT EXISTS idx_scripts_status     ON scripts(status);
CREATE INDEX IF NOT EXISTS idx_scripts_public_id  ON scripts(public_id);
CREATE INDEX IF NOT EXISTS idx_scripts_created_at ON scripts(created_at DESC);

-- One row per loader hit, used to draw the execution chart on the dashboard.
-- event_type is 'fetch' (executor successfully loaded the script) or
-- 'blocked' (a browser UA was turned away).
CREATE TABLE IF NOT EXISTS fetch_events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  script_id   INTEGER NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  event_type  VARCHAR(10) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fetch_events_user_time ON fetch_events(user_id, created_at);

-- Real access keys for key-protected scripts. Generated either by the
-- script owner (from the dashboard) or self-served by an end user visiting
-- the script's public /key/<id> page. Validated at runtime by the
-- obfuscated loader itself via GET /api/keys/validate.
CREATE TABLE IF NOT EXISTS access_keys (
  id          SERIAL PRIMARY KEY,
  script_id   INTEGER NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  key_value   VARCHAR(40) UNIQUE NOT NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'active', -- active | revoked
  note        VARCHAR(120) DEFAULT '',
  uses        INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ,                            -- null = never expires
  last_used_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_keys_script ON access_keys(script_id);
CREATE INDEX IF NOT EXISTS idx_access_keys_value  ON access_keys(key_value);

-- session store table (also auto-created by connect-pg-simple, kept here for reference)
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    VARCHAR NOT NULL COLLATE "default",
  "sess"   JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
) WITH (OIDS=FALSE);

ALTER TABLE "session" DROP CONSTRAINT IF EXISTS "session_pkey";
ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
