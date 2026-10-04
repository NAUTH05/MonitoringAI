"""AI-Cam inference pipeline.

Wires together: frame source -> capture thread -> AI task (license-plate OR
intrusion) -> evidence storage -> AI-Cam database -> optional MonitoringAI
push, while exposing a local status/preview server for diagnostics.

The pipeline is task-agnostic: it selects the task from ``AI_TASK_NAME`` via
``app.tasks.factory`` and only knows the small ``BaseTask`` event contract.
"""
from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from ..config import Settings
from ..integrations import monitoring_api
from ..integrations.aicam_db import AicamEventWriter
from ..integrations.roi_config import RoiConfigProvider
from ..integrations.storage import create_storage, encode_jpeg
from ..services.status_server import StatusServer
from ..sources.factory import create_source
from ..tasks.base import BaseTask
from ..tasks.factory import create_task, resolve_task_name
from .capture import CaptureThread
from .frame_buffer import LatestFrame
from .model_registry import ModelRegistry


class Pipeline:
    def __init__(self, settings: Settings, logger: logging.Logger) -> None:
        self.settings = settings
        self.logger = logger
        self.registry = ModelRegistry(settings, logger)
        self.source = create_source(settings, logger)
        self.buffer = LatestFrame()
        self.capture: Optional[CaptureThread] = None
        self.task: Optional[BaseTask] = None
        self.roi_provider: Optional[RoiConfigProvider] = None
        self.storage = None
        self.db: Optional[AicamEventWriter] = None
        self.status_server: Optional[StatusServer] = None

        self._preview_jpeg: Optional[bytes] = None
        self._preview_ts: float = 0.0
        self._last_processed_seq = -1
        self._start_time = time.time()
        self._last_log = time.time()
        self._last_capture_count = 0
        self._last_processed_count = 0
        self.processed_frames = 0
        self.events_written = 0
        self.last_detection_count = 0
        self.last_event_type: Optional[str] = None
        self.last_plate: Optional[str] = None
        self.last_error: Optional[str] = None
        self.active_tracks = 0

    # ── setup ─────────────────────────────────────────────────────────────
    def setup(self) -> None:
        self.registry.load()
        self.logger.info("Model selection: %s", self.registry.describe())

        self.storage = create_storage(self.settings, self.logger)
        self.logger.info("Storage: %s", self.storage.describe())

        self.db = AicamEventWriter(self.settings.aicam_database_url, self.logger, self.settings.db_enabled)
        if self.db.connect():
            self.db.ensure_schema()

        task_name = resolve_task_name(self.settings.task_name)
        if task_name == "intrusion":
            self.roi_provider = RoiConfigProvider(self.settings, self.logger)
            self.roi_provider.start()
            self.logger.info("ROI provider: %s", self.roi_provider.describe())

        self.task = create_task(
            self.settings, self.registry, self.logger, roi_provider=self.roi_provider
        )
        self.task.load()

        if monitoring_api.is_enabled(self.settings):
            self.logger.info("MonitoringAI event push is ENABLED (type=%s)", self.task.event_type)
        else:
            self.logger.info("MonitoringAI event push is disabled (optional)")

        self.capture = CaptureThread(
            self.source, self.buffer, self.logger, reconnect_delay=self.settings.reconnect_delay
        )

    def _start_services(self) -> None:
        self.capture.start()
        if self.settings.status_enabled:
            self.status_server = StatusServer(
                self.settings.status_host,
                self.settings.status_port,
                self._status,
                self._latest_jpeg,
                self.logger,
            )
            try:
                self.status_server.start()
            except OSError as exc:
                self.last_error = str(exc)
                self.logger.warning("Status server could not start: %s", exc)

    # ── main loop ─────────────────────────────────────────────────────────
    def run(self) -> None:
        if self.task is None:
            self.setup()
        assert self.task is not None and self.capture is not None
        self._start_services()
        interval = 1.0 / max(self.settings.processing_fps, 0.1)
        self.logger.info(
            "Pipeline running | stream_id=%s task=%s source=%s processing_fps=%.1f",
            self.settings.stream_id, self.task.name, self.source.describe(),
            self.settings.processing_fps,
        )
        try:
            while True:
                loop_start = time.time()
                frame, ts, seq = self.buffer.get()
                if frame is not None and seq != self._last_processed_seq:
                    self._last_processed_seq = seq
                    self._process_frame(frame)
                self._maybe_log()
                elapsed = time.time() - loop_start
                sleep_for = interval - elapsed
                if sleep_for > 0:
                    time.sleep(sleep_for)
        except KeyboardInterrupt:
            self.logger.info("Interrupted by user; shutting down")
        finally:
            self.stop()

    def _process_frame(self, frame) -> None:
        try:
            result = self.task.process(frame)
        except Exception as exc:
            self.last_error = str(exc)
            self.logger.exception("Task processing failed: %s", exc)
            return

        self.processed_frames += 1
        self.last_detection_count = int(result.get("count", 0))
        try:
            self.active_tracks = int(self.task.status_extra().get("active_tracks", 0))
        except Exception:
            self.active_tracks = 0

        try:
            annotated = self.task.annotate(frame, result)
            self._preview_jpeg = encode_jpeg(annotated, self.settings.preview_jpeg_quality)
            self._preview_ts = time.time()
        except Exception as exc:
            self.logger.debug("Preview encoding failed: %s", exc)

        if self.task.is_event(result):
            self._emit_event(result, frame)

    def _emit_event(self, result: dict, frame) -> None:
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
        image_key = f"{self.settings.stream_id}/{date_str}/{event_id}.jpg"
        thumb_key = f"{self.settings.stream_id}/{date_str}/{event_id}_thumb.jpg"

        try:
            self.storage.save(image_key, main_img)
            self.storage.save(thumb_key, thumb_img)
        except Exception as exc:
            self.last_error = str(exc)
            self.logger.error("Failed to store event images: %s", exc)
            return

        written = None
        if self.db is not None:
            record = self.task.db_record(fields, image_key, thumb_key)
            if record:
                written = self.db.write_event(
                    stream_id=self.settings.stream_id,
                    task_name=self.settings.task_name,
                    event_time=event_time,
                    event_id=event_id,
                    **record,
                )

        monitoring_api.push_event(
            self.settings,
            self.logger,
            event_type=self.task.event_type,
            confidence=float(fields.get("confidence") or 0.0),
            image_path=image_key,
            event_time=event_time,
        )

        self.events_written += 1
        self.last_event_type = self.task.event_type
        self.last_plate = fields.get("plate_text")
        self.logger.info(
            "EVENT type=%s conf=%.3f fields=%s stored=%s db=%s",
            self.task.event_type,
            float(fields.get("confidence") or 0.0),
            {k: v for k, v in fields.items() if k != "roi_points"},
            image_key,
            "ok" if written else "skipped",
        )

    # ── diagnostics ───────────────────────────────────────────────────────
    def _maybe_log(self) -> None:
        now = time.time()
        if now - self._last_log < 5.0:
            return
        dt = now - self._last_log
        cap_fps = (self.capture.frames_captured - self._last_capture_count) / dt
        proc_fps = (self.processed_frames - self._last_processed_count) / dt
        self._last_log = now
        self._last_capture_count = self.capture.frames_captured
        self._last_processed_count = self.processed_frames
        self.logger.info(
            "alive | capture=%.1ffps measure=%.1ffps detections=%d tracks=%d events=%d preview=%s",
            cap_fps, proc_fps, self.last_detection_count, self.active_tracks,
            self.events_written, "yes" if self._preview_jpeg else "no",
        )

    def _latest_jpeg(self) -> Optional[bytes]:
        return self._preview_jpeg

    def _status(self) -> dict:
        cap = self.capture
        status = {
            "ok": True,
            "stream_id": self.settings.stream_id,
            "task": self.task.name if self.task else self.settings.task_name,
            "event_type": self.task.event_type if self.task else None,
            "source": self.source.describe(),
            "uptime_seconds": round(time.time() - self._start_time, 1),
            "processing_fps_target": self.settings.processing_fps,
            "frames_captured": cap.frames_captured if cap else 0,
            "frames_processed": self.processed_frames,
            "reconnects": cap.reconnects if cap else 0,
            "read_failures": cap.read_failures if cap else 0,
            "last_detection_count": self.last_detection_count,
            "active_tracks": self.active_tracks,
            "last_event_type": self.last_event_type,
            "last_plate": self.last_plate,
            "events_written": self.events_written,
            "db_connected": bool(self.db and self.db._conn is not None),
            "storage": self.storage.describe() if self.storage else None,
            "models": self.registry.describe(),
            "preview_age_seconds": round(time.time() - self._preview_ts, 1) if self._preview_ts else None,
            "last_error": self.last_error,
        }
        if self.task is not None:
            try:
                status.update(self.task.status_extra())
            except Exception:
                pass
        return status

    # ── shutdown ──────────────────────────────────────────────────────────
    def stop(self) -> None:
        if self.capture is not None:
            self.capture.stop()
            if self.capture.is_alive():
                self.capture.join(timeout=5)
        if self.status_server is not None:
            self.status_server.stop()
        if self.roi_provider is not None:
            self.roi_provider.stop()
        if self.db is not None:
            self.db.close()
        self.registry.unload()
        self.logger.info("Pipeline stopped")
