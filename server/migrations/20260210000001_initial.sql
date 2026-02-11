-- Users
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY,
    username    TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    avatar_url  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Servers (guilds)
CREATE TABLE IF NOT EXISTS servers (
    id          UUID PRIMARY KEY,
    name        TEXT NOT NULL,
    owner_id    UUID NOT NULL REFERENCES users(id),
    icon_url    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Channel kind enum
DO $$ BEGIN
    CREATE TYPE channel_kind AS ENUM ('text', 'voice');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Channels
CREATE TABLE IF NOT EXISTS channels (
    id          UUID PRIMARY KEY,
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    kind        channel_kind NOT NULL DEFAULT 'text',
    position    INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id          UUID PRIMARY KEY,
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id   UUID NOT NULL REFERENCES users(id),
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_created
    ON messages (channel_id, created_at DESC);

-- Server members (join table)
CREATE TABLE IF NOT EXISTS server_members (
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (server_id, user_id)
);
