"""Writes license-plate events into the AI-Cam PostgreSQL database.

Schema matches the production AI-Cam database exactly so MonitoringAI's
existing license-plate routes/UI keep working.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

_CREATE_EVENTS = """
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
"""


class AicamEventWriter:
    def __init__(self, dsn: str, logger: logging.Logger, enabled: bool = True) -> None:
        self.dsn = dsn
        self.logger = logger
        self.enabled = enabled
        self._conn = None
        self.last_error: Optional[str] = None

    def connect(self) -> bool:
        if not self.enabled:
            self.logger.info("AI-Cam database writes are disabled (AI_CAM_DB_ENABLED=false)")
            return False
        try:
            import psycopg2

            self._conn = psycopg2.connect(self.dsn, connect_timeout=5)
            self._conn.autocommit = True
            self.logger.info("Connected to AI-Cam database")
            return True
        except Exception as exc:
            self.last_error = str(exc)
            self.logger.error(
                "Cannot connect to AI-Cam database (%s). Events will be written to disk only. "
                "Run scripts/init_aicam_db.py to create it.",
                exc,
            )
            self._conn = None
            return False

    def ensure_schema(self) -> bool:
        if self._conn is None:
            return False
        try:
            with self._conn.cursor() as cur:
                cur.execute(_CREATE_EVENTS)
            self.logger.info("AI-Cam events schema verified")
            return True
        except Exception as exc:
            self.last_error = str(exc)
            self.logger.error("Failed to verify AI-Cam schema: %s", exc)
            return False

    def write_event(
        self,
        *,
        stream_id: str,
        task_name: str,
        event_time: Optional[datetime],
        result: dict,
        plate_text: Optional[str],
        vehicle_type: Optional[str],
        plate_color: Optional[str],
        confidence: Optional[float],
        image_path: str,
        thumbnail_path: Optional[str],
        event_id: Optional[str] = None,
    ) -> Optional[str]:
        if self._conn is None:
            return None
        event_id = event_id or str(uuid.uuid4())
        event_time = event_time or datetime.now(timezone.utc)
        try:
            from psycopg2.extras import Json

            with self._conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO public.events
                        (id, stream_id, task_name, event_time, result, plate_text,
                         vehicle_type, plate_color, confidence, image_path, thumbnail_path, created_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
                    """,
                    (
                        event_id,
                        stream_id,
                        task_name,
                        event_time,
                        Json(result or {}),
                        plate_text,
                        vehicle_type,
                        plate_color,
                        confidence,
                        image_path,
                        thumbnail_path,
                    ),
                )
            return event_id
        except Exception as exc:
            self.last_error = str(exc)
            self.logger.error("Failed to write AI-Cam event: %s", exc)
            return None

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None
