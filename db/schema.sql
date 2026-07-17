-- luvenn.xyz database schema (Postgres / Neon)

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  username        VARCHAR(32) UNIQUE NOT NULL,
  username_lower  VARCHAR(32) UNIQUE NOT NULL,
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
  is_banned       BOOLEAN NOT NULL DEFAULT FALSE,
  bio             VARCHAR(280) DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scripts (
  id              SERIAL PRIMARY KEY,
  public_id       VARCHAR(24) UNIQUE NOT NULL,      -- random token used in the raw/share URL
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(80) NOT NULL,
  description     VARCHAR(500) DEFAULT '',
  game_name       VARCHAR(100) DEFAULT '',
  game_id         VARCHAR(40) DEFAULT '',            -- optional Roblox place/universe id
  category        VARCHAR(40) DEFAULT 'other',
  code            TEXT NOT NULL,
  has_key_system  BOOLEAN NOT NULL DEFAULT FALSE,
  key_link        VARCHAR(300) DEFAULT '',
  status          VARCHAR(20) NOT NULL DEFAULT 'published', -- published | pending | removed
  views           INTEGER NOT NULL DEFAULT 0,
  fetches         INTEGER NOT NULL DEFAULT 0,        -- raw executor fetches
  featured        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scripts_user      ON scripts(user_id);
CREATE INDEX IF NOT EXISTS idx_scripts_status     ON scripts(status);
CREATE INDEX IF NOT EXISTS idx_scripts_public_id  ON scripts(public_id);
CREATE INDEX IF NOT EXISTS idx_scripts_created_at ON scripts(created_at DESC);

-- session store table (also auto-created by connect-pg-simple, kept here for reference)
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    VARCHAR NOT NULL COLLATE "default",
  "sess"   JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
) WITH (OIDS=FALSE);

ALTER TABLE "session" DROP CONSTRAINT IF EXISTS "session_pkey";
ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- To make the first account an admin, run this manually once in the Neon SQL editor:
-- UPDATE users SET is_admin = TRUE WHERE username_lower = 'yourusername';
