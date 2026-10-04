"""Per-camera runtime configuration discovered from MonitoringAI.

The AI service no longer depends on per-camera ``.env`` values. It polls
``GET /api/ai/runtime-config`` (``x-api-key``) and builds one
:class:`CameraRuntimeConfig` per camera; adding/removing/editing a camera is a
database change, not an env edit.

A legacy single-camera config can still be synthesised from the environment
(:func:`from_legacy_env`) for offline testing / a fixed local demo.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# Module codes that map onto a runnable AI task.
_INTRUSION_CODES = {"INTRUSION"}
_PLATE_CODES = {"VEHICLE", "LICENSE_PLATE", "ANPR"}


@dataclass
class ModuleConfig:
    code: str
    enabled: bool = True
    config: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CameraRuntimeConfig:
    camera_id: str
    name: str
    stream_name: Optional[str] = None
    ai_source_url: Optional[str] = None
    enabled: bool = True
    modules: List[ModuleConfig] = field(default_factory=list)
    source_type: str = "rtsp"      # rtsp | webcam
    webcam_device: int = 0

    # ── derived ───────────────────────────────────────────────────────────
    @property
    def task_name(self) -> str:
        """Which AI task to run, from the enabled modules (intrusion wins)."""
        codes = {m.code.upper() for m in self.modules if m.enabled}
        if codes & _INTRUSION_CODES:
            return "intrusion"
        if codes & _PLATE_CODES:
            return "license_plate"
        return "intrusion"

    @property
    def event_type(self) -> str:
        return "INTRUSION" if self.task_name == "intrusion" else "VEHICLE"

    def roi_polygon(self) -> Optional[list]:
        for m in self.modules:
            if m.code.upper() == "INTRUSION" and m.enabled:
                return (m.config or {}).get("roiPolygon")
        return None

    def identity(self) -> str:
        """Fingerprint of the RESTART-worthy settings (source + task).

        The ROI is deliberately excluded: it is applied live via
        ``CameraWorker.update_runtime`` so a polygon edit never restarts the
        worker (and never the model).
        """
        return json.dumps(
            {
                "url": self.ai_source_url,
                "type": self.source_type,
                "device": self.webcam_device,
                "task": self.task_name,
            },
            sort_keys=True,
            default=str,
        )


def parse_runtime_config(payload: Any) -> List[CameraRuntimeConfig]:
    """Parse the ``GET /api/ai/runtime-config`` payload into configs."""
    if isinstance(payload, dict):
        items = payload.get("data", payload.get("cameras", []))
    else:
        items = payload
    if not isinstance(items, list):
        return []

    out: List[CameraRuntimeConfig] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        camera_id = item.get("cameraId") or item.get("camera_id")
        if not camera_id:
            continue

        modules: List[ModuleConfig] = []
        for raw in item.get("modules", []) or []:
            if not isinstance(raw, dict):
                continue
            modules.append(
                ModuleConfig(
                    code=str(raw.get("code", "")).upper(),
                    enabled=bool(raw.get("enabled", True)),
                    config=dict(raw.get("config") or {}),
                )
            )

        url = item.get("aiSourceUrl") or item.get("ai_source_url")
        out.append(
            CameraRuntimeConfig(
                camera_id=str(camera_id),
                name=str(item.get("name") or camera_id),
                stream_name=item.get("streamName") or item.get("stream_name"),
                ai_source_url=url,
                enabled=bool(item.get("enabled", True)),
                modules=modules,
                source_type="rtsp" if url else "webcam",
            )
        )
    return out


def from_legacy_env(settings) -> CameraRuntimeConfig:
    """Synthesise a single-camera config from .env (offline/dev fallback)."""
    task = (getattr(settings, "task_name", "intrusion") or "intrusion").strip().lower()
    code = "INTRUSION" if task in ("intrusion", "restricted_zone", "person") else "VEHICLE"
    return CameraRuntimeConfig(
        camera_id=getattr(settings, "monitoring_camera_id", None) or "local",
        name="local",
        stream_name=getattr(settings, "stream_id", None),
        ai_source_url=getattr(settings, "camera_url", None),
        enabled=True,
        modules=[ModuleConfig(code=code, enabled=True, config={})],
        source_type=getattr(settings, "source_type", "webcam"),
        webcam_device=int(getattr(settings, "webcam_device", 0) or 0),
    )
