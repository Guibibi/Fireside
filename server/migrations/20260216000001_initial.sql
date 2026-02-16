-- User roles
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('operator', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Users
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT,
    avatar_url    TEXT,
    role          user_role NOT NULL DEFAULT 'member',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Channel kind enum
DO $$ BEGIN
    CREATE TYPE channel_kind AS ENUM ('text', 'voice');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Channels
CREATE TABLE IF NOT EXISTS channels (
    id           UUID PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    kind         channel_kind NOT NULL DEFAULT 'text',
    position     INT NOT NULL DEFAULT 0,
    opus_bitrate INTEGER,
    opus_dtx     BOOLEAN,
    opus_fec     BOOLEAN,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
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

-- Media assets
CREATE TABLE IF NOT EXISTS media_assets (
    id              UUID PRIMARY KEY,
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id       UUID REFERENCES media_assets(id) ON DELETE CASCADE,
    derivative_kind TEXT,
    mime_type       TEXT NOT NULL,
    bytes           BIGINT NOT NULL,
    checksum        TEXT NOT NULL,
    storage_key     TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_owner_created
    ON media_assets (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_assets_status_updated
    ON media_assets (status, updated_at ASC);

CREATE INDEX IF NOT EXISTS idx_media_assets_parent
    ON media_assets (parent_id)
    WHERE parent_id IS NOT NULL;

-- Message attachments
CREATE TABLE IF NOT EXISTS message_attachments (
    id          UUID PRIMARY KEY,
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    media_id    UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    mime_type   TEXT NOT NULL,
    bytes       BIGINT NOT NULL,
    width       INTEGER,
    height      INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message
    ON message_attachments (message_id, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_attachments_unique_message_media
    ON message_attachments (message_id, media_id);

-- Invites
CREATE TABLE IF NOT EXISTS invites (
    id          UUID PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    created_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    single_use  BOOLEAN NOT NULL DEFAULT true,
    used_count  INT NOT NULL DEFAULT 0,
    max_uses    INT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ,
    revoked     BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_invites_code ON invites (code);
