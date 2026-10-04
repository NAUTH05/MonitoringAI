"""Runtime ROI configuration for the intrusion task.

The ROI polygon lives in MonitoringAI's ``CameraModule.config.roiPolygon`` and
is edited from the frontend (``RoiDrawerModal``). The AI runtime must pick up
edits **without retraining and without restarting the neural network**, so this
module keeps the latest polygon in memory and refreshes it from a lightweight
background poll.

Two sources are supported (``AI_ROI_SOURCE``):

``config`` (default when a MonitoringAI camera id is configured)
    Poll ``GET {MONITORING_API_URL}/cameras/{MONITORING_CAMERA_ID}/ai-config``
    with the shared ``x-api-key``. The endpoint is read-only and machine-to-
    machine; the AI runtime never logs in as a human user.

``static``
    Read the polygon once from ``AI_ROI_FILE`` (JSON) or the inline
    ``AI_ROI_POLYGON`` env var. Useful for offline tests / a fixed demo.

The provider never raises into the inference loop: on any error it keeps the
last good polygon (and starts with ``None`` = "no restricted zone").
"""
from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any, List, Optional, Tuple

from ..tasks.intrusion.geometry import normalize_polygon

Point = Tuple[float, float]


class RoiConfigProvider:
    def __init__(self, settings, logger: logging.Logger) -> None:
        self.settings = settings
        self.logger = logger
        self._lock = threading.Lock()
        self._polygon: Optional[List[Point]] = None
        self._raw: Optional[Any] = None
        self._last_error: Optional[str] = None
        self._last_ok_ms: float = 0.0
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # ── lifecycle ─────────────────────────────────────────────────────────
    def start(self) -> None:
        self.refresh()  # best-effort initial load
        if self._mode() == "config" and self.settings.roi_poll_seconds > 0:
            self._thread = threading.Thread(
                target=self._poll_loop, name="roi-config", daemon=True
            )
            self._thread.start()
            self.logger.info(
                "ROI config polling every %.1fs (camera=%s)",
                self.settings.roi_poll_seconds,
                self.settings.monitoring_camera_id,
            )

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=3)

    # ── public API ────────────────────────────────────────────────────────
    def current(self) -> Optional[List[Point]]:
        """Latest normalized ROI polygon, or ``None`` when unconfigured."""
        with self._lock:
            return list(self._polygon) if self._polygon else None

    def describe(self) -> dict:
        with self._lock:
            return {
                "source": self._mode(),
                "points": len(self._polygon) if self._polygon else 0,
                "polygon": self._polygon,
                "last_ok_ms": self._last_ok_ms or None,
                "last_error": self._last_error,
            }

    def refresh(self) -> bool:
        """Fetch the polygon once. Returns True when a valid polygon was set."""
        try:
            raw = self._fetch_raw()
        except Exception as exc:  # network/parse errors must not break inference
            with self._lock:
                self._last_error = str(exc)
            self.logger.debug("ROI config refresh failed: %s", exc)
            return False

        polygon = normalize_polygon(raw)
        with self._lock:
            self._raw = raw
            if polygon is not None:
                changed = polygon != self._polygon
                self._polygon = polygon
                self._last_ok_ms = time.time() * 1000.0
                self._last_error = None
            else:
                # Empty / fewer than 3 points = no restricted zone configured.
                changed = self._polygon is not None
                self._polygon = None
                self._last_error = None if raw in (None, [], {}) else "invalid polygon"
        if changed:
            self.logger.info("ROI updated: %s", self._polygon)
        return polygon is not None

    # ── internals ─────────────────────────────────────────────────────────
    def _mode(self) -> str:
        mode = (self.settings.roi_source or "static").strip().lower()
        if mode == "config" and not self._config_ready():
            return "static"
        return mode

    def _config_ready(self) -> bool:
        return bool(
            self.settings.monitoring_api_url
            and self.settings.monitoring_api_key
            and self.settings.monitoring_camera_id
        )

    def _poll_loop(self) -> None:
        while not self._stop.wait(max(1.0, float(self.settings.roi_poll_seconds))):
            self.refresh()

    def _fetch_raw(self) -> Any:
        if self._mode() == "config":
            return self._fetch_from_backend()
        return self._fetch_from_static()

    def _fetch_from_static(self) -> Any:
        inline = getattr(self.settings, "roi_polygon_inline", None)
        if inline:
            return json.loads(inline)
        path: Optional[Path] = getattr(self.settings, "roi_file", None)
        if path is not None and Path(path).exists():
            return json.loads(Path(path).read_text(encoding="utf-8"))
        return None

    def _fetch_from_backend(self) -> Any:
        base = (self.settings.monitoring_api_url or "").rstrip("/")
        url = f"{base}/cameras/{self.settings.monitoring_camera_id}/ai-config"
        req = urllib.request.Request(
            url, method="GET", headers={"x-api-key": self.settings.monitoring_api_key or ""}
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        data = payload.get("data", payload) if isinstance(payload, dict) else {}
        for module in data.get("modules", []) or []:
            if str(module.get("code", "")).upper() != "INTRUSION":
                continue
            if module.get("enabled") is False:
                return None
            config = module.get("config") or {}
            return config.get("roiPolygon")
        return None
