CREATE TABLE IF NOT EXISTS emojis (
    id          UUID PRIMARY KEY,
    shortcode   TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    media_id    UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    created_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emojis_shortcode ON emojis (shortcode);
CREATE INDEX IF NOT EXISTS idx_emojis_created_by ON emojis (created_by);
