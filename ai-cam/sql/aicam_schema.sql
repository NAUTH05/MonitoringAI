-- AI-Cam PostgreSQL schema.
-- Matches the production AI-Cam database so MonitoringAI's existing
-- license-plate routes/UI work unchanged. Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS public.events (
    id uuid NOT NULL PRIMARY KEY,
    stream_id varchar(64) NOT NULL,
    task_name varchar(64) NOT NULL,
    event_time timestamptz NOT NULL,
    result json NOT NULL DEFAULT '{}'::json,
    plate_text varchar(16),
    vehicle_type varchar(32),
    plate_color varchar(16),
    confidence double precision,
    image_path text NOT NULL,
    thumbnail_path text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_stream_time
    ON public.events (stream_id, event_time DESC);

CREATE TABLE IF NOT EXISTS public.streams (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name varchar(128),
    url text NOT NULL,
    tasks json NOT NULL DEFAULT '[]'::json,
    parallel boolean NOT NULL DEFAULT true,
    status varchar(16) NOT NULL DEFAULT 'stopped',
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_streams_status ON public.streams (status);

CREATE TABLE IF NOT EXISTS public.alembic_version (
    version_num varchar(32) NOT NULL
);
