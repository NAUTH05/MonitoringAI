-- Create the deterministic MonitoringAI camera record for the local webcam.
-- rtsp_url embeds the go2rtc stream name (laptop_webcam), which is what
-- MonitoringAI uses to (a) play the stream and (b) map license-plate events
-- whose stream_id = laptop_webcam to this camera. Idempotent.

INSERT INTO cameras (id, name, location, rtsp_url, status, is_active, created_at, updated_at)
SELECT
    gen_random_uuid(),
    'Laptop Webcam',
    'Local Development',
    'http://localhost:1984/api/stream.m3u8?src=laptop_webcam',
    'ONLINE',
    true,
    now(),
    now()
WHERE NOT EXISTS (
    SELECT 1 FROM cameras
    WHERE rtsp_url LIKE '%laptop_webcam%' AND is_active = true
);
