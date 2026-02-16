ALTER TABLE media_assets
    ADD COLUMN IF NOT EXISTS width INTEGER,
    ADD COLUMN IF NOT EXISTS height INTEGER;

UPDATE media_assets AS media
SET
    width = attachment_dims.width,
    height = attachment_dims.height
FROM (
    SELECT
        media_id,
        MAX(width) AS width,
        MAX(height) AS height
    FROM message_attachments
    WHERE width IS NOT NULL AND height IS NOT NULL
    GROUP BY media_id
) AS attachment_dims
WHERE media.id = attachment_dims.media_id
  AND (media.width IS NULL OR media.height IS NULL);

CREATE INDEX IF NOT EXISTS idx_messages_channel_created_id_desc
    ON messages (channel_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_reactions_message_emoji_unicode
    ON reactions (message_id, emoji_id, unicode_emoji);
