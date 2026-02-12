ALTER TABLE channels
    DROP CONSTRAINT IF EXISTS channels_server_id_fkey;

DROP TABLE IF EXISTS server_members;
DROP TABLE IF EXISTS servers;
