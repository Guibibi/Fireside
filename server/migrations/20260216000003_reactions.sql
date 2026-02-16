CREATE TABLE IF NOT EXISTS reactions (
    id             UUID PRIMARY KEY,
    message_id     UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji_id       UUID REFERENCES emojis(id) ON DELETE CASCADE,
    unicode_emoji  TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_emoji_source CHECK (
        (emoji_id IS NOT NULL AND unicode_emoji IS NULL)
        OR (emoji_id IS NULL AND unicode_emoji IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions (message_id);
CREATE INDEX IF NOT EXISTS idx_reactions_user ON reactions (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_unique_user_message_emoji
    ON reactions (
        message_id,
        user_id,
        COALESCE(emoji_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(unicode_emoji, '')
    );
