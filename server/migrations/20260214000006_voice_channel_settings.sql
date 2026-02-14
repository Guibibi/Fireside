-- Per-voice-channel Opus codec configuration
ALTER TABLE channels
ADD COLUMN IF NOT EXISTS opus_bitrate INTEGER,
ADD COLUMN IF NOT EXISTS opus_dtx BOOLEAN,
ADD COLUMN IF NOT EXISTS opus_fec BOOLEAN;
