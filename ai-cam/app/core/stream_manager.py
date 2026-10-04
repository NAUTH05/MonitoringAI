"""Multi-camera stream manager.

Discovers enabled cameras from MonitoringAI (``GET /api/ai/runtime-config``) and
keeps one :class:`~app.core.camera_worker.CameraWorker` per camera, reconciling
on a poll:

    camera added            -> start a worker
    camera removed/disabled -> stop its worker
    source/task changed     -> restart that worker
    ROI changed             -> live update (no restart)

Only the changed camera is touched; the whole AI service is never restarted for
a single camera change. Models / storage / DB writer are shared across workers.

Set ``AI_RUNTIME_CONFIG=false`` to fall back to the legacy single-camera mode
(one synthetic config built from the environment) — useful for offline tests.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Dict, List, Optional

from ..integrations import monitoring_api
from ..integrations.aicam_db import AicamEventWriter
from ..integrations.roi_config import MutableRoiProvider, RoiConfigProvider
from ..integrations.storage import create_storage
from ..services.status_server import StatusServer
from .camera_config import CameraRuntimeConfig, from_legacy_env, parse_runtime_config
from .camera_worker import CameraWorker
from .model_registry import ModelRegistry


class StreamManager:
    def __init__(self, settings, logger: logging.Logger) -> None:
        self.settings = settings
        self.logger = logger
        self.registry = ModelRegistry(settings, logger)
        self.storage = None
        self.db: Optional[AicamEventWriter] = None
        self.workers: Dict[str, CameraWorker] = {}
        self._status_server: Optional[StatusServer] = None
        self._stop = threading.Event()
        self._start_time = time.time()
        self._last_log = time.time()
        self._last_config_error: Optional[str] = None
        self._processed_before = 0
        self._events_before = 0

    @property
    def mode(self) -> str:
        return "runtime-config" if self.settings.runtime_config_enabled else "legacy-env"

    # ── setup ─────────────────────────────────────────────────────────────
    def setup(self) -> None:
        self.registry.load()
        self.logger.info("Model selection: %s", self.registry.describe())

        self.storage = create_storage(self.settings, self.logger)
        self.logger.info("Storage: %s", self.storage.describe())

        self.db = AicamEventWriter(
            self.settings.aicam_database_url, self.logger, self.settings.db_enabled
        )
        if self.db.connect():
            self.db.ensure_schema()

        if monitoring_api.is_enabled(self.settings):
            self.logger.info("MonitoringAI bridge ENABLED (events + runtime config)")
        else:
            self.logger.info("MonitoringAI bridge disabled (optional)")

    def _start_status_server(self) -> None:
        if not self.settings.status_enabled:
            return
        self._status_server = StatusServer(
            self.settings.status_host,
            self.settings.status_port,
            self._status,
            self._jpeg,
            self.logger,
        )
        try:
            self._status_server.start()
        except OSError as exc:
            self.logger.warning("Status server could not start: %s", exc)

    # ── main loop ─────────────────────────────────────────────────────────
    def run(self) -> None:
        self.setup()
        self._start_status_server()
        self.logger.info(
            "StreamManager running | mode=%s poll=%.1fs fps_per_camera=%.1f",
            self.mode, self.settings.runtime_config_poll_seconds,
            self.settings.processing_fps,
        )
        interval = 1.0 / max(self.settings.processing_fps, 0.1)
        try:
            while not self._stop.is_set():
                configs = self._fetch_configs()
                if configs is not None:
                    self._reconcile(configs)
                now = time.time()
                for worker in list(self.workers.values()):
                    if worker.due(now, interval):
                        worker.tick(now)
                self._maybe_log()
                self._stop.wait(0.02)
        except KeyboardInterrupt:
            self.logger.info("Interrupted by user; shutting down")
        finally:
            self.stop()

    def _fetch_configs(self) -> Optional[List[CameraRuntimeConfig]]:
        if not self.settings.runtime_config_enabled:
            return [from_legacy_env(self.settings)]

        payload = monitoring_api.fetch_runtime_config(self.settings, self.logger)
        if payload is None:
            # Keep the current workers on a transient backend error.
            self._last_config_error = "runtime-config unavailable"
            return None
        self._last_config_error = None
        return parse_runtime_config(payload)

    # ── reconcile ─────────────────────────────────────────────────────────
    def _reconcile(self, configs: List[CameraRuntimeConfig]) -> None:
        desired = {c.camera_id: c for c in configs if c.enabled}

        for camera_id in list(self.workers):
            if camera_id not in desired:
                self.logger.info("Camera %s removed/disabled -> stopping worker", camera_id)
                self.workers.pop(camera_id).stop()

        for camera_id, cfg in desired.items():
            worker = self.workers.get(camera_id)
            if worker is None:
                self._start_worker(cfg)
            elif worker.identity != cfg.identity():
                self.logger.info("Camera %s source/task changed -> restarting worker", camera_id)
                self.workers.pop(camera_id).stop()
                self._start_worker(cfg)
            else:
                # Same source/task: apply the ROI live (no restart).
                worker.update_runtime(cfg)

    def _start_worker(self, cfg: CameraRuntimeConfig) -> None:
        try:
            worker = CameraWorker(
                self.settings, cfg, self.registry, self.storage, self.db,
                self.logger, roi_provider=self._make_roi_provider(cfg),
            )
            worker.start()
            self.workers[cfg.camera_id] = worker
        except Exception as exc:
            self._last_config_error = f"worker {cfg.name}: {exc}"
            self.logger.error("Failed to start worker for camera %s: %s", cfg.name, exc)

    def _make_roi_provider(self, cfg: CameraRuntimeConfig):
        if self.settings.runtime_config_enabled:
            # ROI arrives inside the runtime-config payload.
            return MutableRoiProvider()
        provider = RoiConfigProvider(self.settings, self.logger)
        provider.start()
        return provider

    # ── diagnostics ───────────────────────────────────────────────────────
    def _maybe_log(self) -> None:
        now = time.time()
        if now - self._last_log < 5.0:
            return
        dt = now - self._last_log
        self._last_log = now
        total_processed = sum(w.processed_frames for w in self.workers.values())
        total_events = sum(w.events_written for w in self.workers.values())
        proc_fps = (total_processed - self._processed_before) / dt
        self._processed_before = total_processed
        self._events_before = total_events
        self.logger.info(
            "alive | mode=%s cameras=%d measure=%.1ffps events=%d",
            self.mode, len(self.workers), proc_fps, total_events,
        )

    def _status(self) -> dict:
        return {
            "ok": True,
            "mode": self.mode,
            "uptime_seconds": round(time.time() - self._start_time, 1),
            "camera_count": len(self.workers),
            "processing_fps_target": self.settings.processing_fps,
            "storage": self.storage.describe() if self.storage else None,
            "models": self.registry.describe(),
            "last_config_error": self._last_config_error,
            "cameras": [w.status() for w in self.workers.values()],
        }

    def _jpeg(self, camera_id: Optional[str] = None):
        if camera_id and camera_id in self.workers:
            return self.workers[camera_id].latest_jpeg()
        for worker in self.workers.values():
            jpeg = worker.latest_jpeg()
            if jpeg:
                return jpeg
        return None

    # ── shutdown ──────────────────────────────────────────────────────────
    def stop(self) -> None:
        for worker in list(self.workers.values()):
            try:
                worker.stop()
            except Exception as exc:
                self.logger.warning("Error stopping worker: %s", exc)
        self.workers.clear()
        if self._status_server is not None:
            self._status_server.stop()
        if self.db is not None:
            self.db.close()
        self.registry.unload()
        self.logger.info("StreamManager stopped")
