ALTER TABLE users
    ADD COLUMN IF NOT EXISTS profile_description TEXT,
    ADD COLUMN IF NOT EXISTS profile_status TEXT;

CREATE TABLE IF NOT EXISTS dm_threads (
    id UUID PRIMARY KEY,
    user_a_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (user_a_id <> user_b_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_threads_user_pair
    ON dm_threads (LEAST(user_a_id, user_b_id), GREATEST(user_a_id, user_b_id));

CREATE INDEX IF NOT EXISTS idx_dm_threads_user_a_created
    ON dm_threads (user_a_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_dm_threads_user_b_created
    ON dm_threads (user_b_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS dm_messages (
    id UUID PRIMARY KEY,
    thread_id UUID NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dm_messages_thread_created
    ON dm_messages (thread_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS dm_read_state (
    thread_id UUID NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_message_id UUID REFERENCES dm_messages(id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_read_state_user_thread
    ON dm_read_state (user_id, thread_id);
