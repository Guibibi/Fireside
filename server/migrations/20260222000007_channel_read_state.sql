CREATE TABLE IF NOT EXISTS channel_read_state (
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_read_state_user_channel
    ON channel_read_state (user_id, channel_id);

CREATE INDEX IF NOT EXISTS idx_channel_read_state_last_read_message
    ON channel_read_state (last_read_message_id)
    WHERE last_read_message_id IS NOT NULL;
