CREATE TABLE IF NOT EXISTS dm_reactions (
    id             UUID PRIMARY KEY,
    dm_message_id  UUID NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji_id       UUID REFERENCES emojis(id) ON DELETE CASCADE,
    unicode_emoji  TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_dm_reaction_emoji_source CHECK (
        (emoji_id IS NOT NULL AND unicode_emoji IS NULL)
        OR (emoji_id IS NULL AND unicode_emoji IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_dm_reactions_message ON dm_reactions (dm_message_id);
CREATE INDEX IF NOT EXISTS idx_dm_reactions_user ON dm_reactions (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_reactions_unique_user_message_emoji
    ON dm_reactions (
        dm_message_id,
        user_id,
        COALESCE(emoji_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(unicode_emoji, '')
    );
