"""One camera worker.

Owns everything that used to live in the single-camera ``Pipeline`` — the frame
source, capture thread, AI task, ROI provider and evidence session — but scoped
to ONE camera. The :class:`~app.core.stream_manager.StreamManager` starts/stops
workers as cameras are added, disabled or removed, and drives
:meth:`CameraWorker.tick` from a single processing loop (one shared model, no
concurrent inference on the same weights).

Models, storage and the AI-Cam DB writer are SHARED and injected by the manager.
"""
from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import numpy as np

from ..integrations import monitoring_api
from ..integrations.storage import encode_jpeg
from ..services.evidence_session import EvidenceSession
from ..sources.factory import create_source_for
from ..tasks.factory import create_task
from ..tasks.intrusion.geometry import normalize_polygon
from .capture import CaptureThread
from .frame_buffer import LatestFrame


class CameraWorker:
    def __init__(
        self,
        settings,
        runtime,
        registry: Any,
        storage: Any,
        db: Any,
        logger: logging.Logger,
        roi_provider: Any = None,
    ) -> None:
        self.settings = settings
        self.runtime = runtime
        self.registry = registry
        self.storage = storage
        self.db = db
        self.logger = logger

        self.camera_id = runtime.camera_id
        self.name = runtime.name
        self.stream_id = runtime.stream_name or runtime.camera_id
        self.task_name = runtime.task_name

        self.buffer = LatestFrame()
        self.source = create_source_for(runtime, settings, logger)
        self.capture = CaptureThread(
            self.source, self.buffer, logger, reconnect_delay=settings.reconnect_delay
        )
        self.roi_provider = roi_provider
        self.task = create_task(
            settings, registry, logger,
            roi_provider=roi_provider, task_name=self.task_name,
        )
        self.task.load()

        self._preview_jpeg: Optional[bytes] = None
        self._preview_ts = 0.0
        self._last_processed_seq = -1
        self._last_process_at = 0.0
        self._session: Optional[EvidenceSession] = None
        self._identity = runtime.identity()
        self._started_at = time.time()

        self.processed_frames = 0
        self.events_written = 0
        self.last_detection_count = 0
        self.last_event_type: Optional[str] = None
        self.last_error: Optional[str] = None
        self.active_tracks = 0

        # Apply the initial ROI from the runtime config.
        self._apply_roi()

    # ── lifecycle ─────────────────────────────────────────────────────────
    @property
    def identity(self) -> str:
        return self._identity

    def start(self) -> None:
        self.capture.start()
        self.logger.info(
            "Camera worker started | id=%s name=%s task=%s source=%s",
            self.camera_id, self.name, self.task_name, self.source.describe(),
        )

    def stop(self) -> None:
        if self._session is not None:
            try:
                self._session.finish()
            except Exception as exc:
                self.logger.warning("Failed to finalize evidence session: %s", exc)
            self._session = None
        self.capture.stop()
        if self.capture.is_alive():
            self.capture.join(timeout=5)
        if self.roi_provider is not None:
            try:
                self.roi_provider.stop()
            except Exception:
                pass
        self.logger.info("Camera worker stopped | id=%s", self.camera_id)

    # ── per-frame ─────────────────────────────────────────────────────────
    def due(self, now: float, interval: float) -> bool:
        return (now - self._last_process_at) >= interval

    def tick(self, now: float) -> None:
        self._last_process_at = now
        frame, _ts, seq = self.buffer.get()
        if frame is None or seq == self._last_processed_seq:
            return
        self._last_processed_seq = seq
        self._process_frame(frame)

    def _process_frame(self, frame: np.ndarray) -> None:
        try:
            result = self.task.process(frame)
        except Exception as exc:
            self.last_error = str(exc)
            self.logger.exception("Task processing failed (%s): %s", self.name, exc)
            return

        self.processed_frames += 1
        self.last_detection_count = int(result.get("count", 0))
        try:
            self.active_tracks = int(self.task.status_extra().get("active_tracks", 0))
        except Exception:
            self.active_tracks = 0

        annotated = None
        try:
            annotated = self.task.annotate(frame, result)
            self._preview_jpeg = encode_jpeg(annotated, self.settings.preview_jpeg_quality)
            self._preview_ts = time.time()
        except Exception as exc:
            self.logger.debug("Preview encoding failed (%s): %s", self.name, exc)

        if self.task.is_event(result):
            self._emit_event(result, frame, annotated)

        if self._session is not None:
            try:
                self._session.update(self.task.session_active(result), annotated, time.time())
            except Exception as exc:
                self.logger.exception("Evidence session update failed (%s): %s", self.name, exc)
            if self._session.finished:
                self.logger.info("Evidence session finished (%s): %s", self.name, self._session.describe())
                self._session = None

    def _emit_event(self, result: dict, frame: np.ndarray, annotated: Optional[np.ndarray]) -> None:
        fields = self.task.event_fields(result) or {}
        images = self.task.event_images(frame, result)
        if images is None:
            return
        main_img, thumb_img = images
        if thumb_img is None:
            thumb_img = main_img

        event_time = datetime.now(timezone.utc)
        date_str = event_time.strftime("%Y-%m-%d")
        event_id = str(uuid.uuid4())
        image_key = f"{self.stream_id}/{date_str}/{event_id}/image_0001.jpg"
        thumb_key = f"{self.stream_id}/{date_str}/{event_id}/thumb.jpg"

        try:
            self.storage.save_image(image_key, main_img)
            self.storage.save_image(thumb_key, thumb_img)
        except Exception as exc:
            self.last_error = str(exc)
            self.logger.error("Failed to store event images (%s): %s", self.name, exc)
            return

        written = None
        if self.db is not None:
            record = self.task.db_record(fields, image_key, thumb_key)
            if record:
                written = self.db.write_event(
                    stream_id=self.stream_id,
                    task_name=self.task_name,
                    event_time=event_time,
                    event_id=event_id,
                    **record,
                )

        backend_event_id = monitoring_api.push_event(
            self.settings,
            self.logger,
            event_type=self.task.event_type,
            confidence=float(fields.get("confidence") or 0.0),
            image_path=image_key,
            event_time=event_time,
            camera_id=self.camera_id,
        )

        if getattr(self.task, "supports_evidence_session", False) and annotated is not None:
            self._session = EvidenceSession(
                self.settings,
                self.storage,
                self.logger,
                event_id=backend_event_id,
                ai_event_id=event_id,
                stream_id=self.stream_id,
                record_source=self.runtime.ai_source_url,
            )
            self._session.start(annotated, time.time())
            self.logger.info("Evidence session started (%s): %s", self.name, self._session.describe())

        self.events_written += 1
        self.last_event_type = self.task.event_type
        self.logger.info(
            "EVENT cam=%s type=%s conf=%.3f stored=%s db=%s",
            self.name, self.task.event_type,
            float(fields.get("confidence") or 0.0), image_key, "ok" if written else "skipped",
        )

    # ── config updates ────────────────────────────────────────────────────
    def update_runtime(self, runtime) -> None:
        """Apply a live config change (ROI). Source changes are handled by the
        manager (it restarts the worker) because they need a new capture thread."""
        self.runtime = runtime
        self._identity = runtime.identity()
        self._apply_roi()

    def _apply_roi(self) -> None:
        if self.roi_provider is None or not hasattr(self.roi_provider, "set"):
            return
        polygon = normalize_polygon(self.runtime.roi_polygon())
        if polygon != self.roi_provider.current():
            self.roi_provider.set(polygon)
            self.logger.info(
                "ROI updated for %s (%d points)", self.name, len(polygon) if polygon else 0
            )

    # ── diagnostics ───────────────────────────────────────────────────────
    def latest_jpeg(self) -> Optional[bytes]:
        return self._preview_jpeg

    def status(self) -> dict:
        status = {
            "camera_id": self.camera_id,
            "name": self.name,
            "stream_id": self.stream_id,
            "task": self.task_name,
            "event_type": self.task.event_type,
            "source": self.source.describe(),
            "uptime_seconds": round(time.time() - self._started_at, 1),
            "frames_captured": self.capture.frames_captured,
            "frames_processed": self.processed_frames,
            "reconnects": self.capture.reconnects,
            "read_failures": self.capture.read_failures,
            "last_detection_count": self.last_detection_count,
            "active_tracks": self.active_tracks,
            "last_event_type": self.last_event_type,
            "events_written": self.events_written,
            "evidence_session": self._session.describe() if self._session else None,
            "preview_age_seconds": (
                round(time.time() - self._preview_ts, 1) if self._preview_ts else None
            ),
            "last_error": self.last_error,
        }
        try:
            status.update(self.task.status_extra())
        except Exception:
            pass
        return status
