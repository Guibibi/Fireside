CREATE TABLE IF NOT EXISTS message_attachments (
    id UUID PRIMARY KEY,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    media_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    mime_type TEXT NOT NULL,
    bytes BIGINT NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message
    ON message_attachments (message_id, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_attachments_unique_message_media
    ON message_attachments (message_id, media_id);
