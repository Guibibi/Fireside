CREATE TABLE IF NOT EXISTS media_assets (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES media_assets(id) ON DELETE CASCADE,
    derivative_kind TEXT,
    mime_type TEXT NOT NULL,
    bytes BIGINT NOT NULL,
    checksum TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_owner_created
    ON media_assets (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_assets_status_updated
    ON media_assets (status, updated_at ASC);

CREATE INDEX IF NOT EXISTS idx_media_assets_parent
    ON media_assets (parent_id)
    WHERE parent_id IS NOT NULL;
