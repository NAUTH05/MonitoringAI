"""Optional bridge that pushes a generic VEHICLE event into MonitoringAI.

License-plate data is normally read by MonitoringAI straight from the AI-Cam
database, so this bridge is OFF unless MONITORING_API_URL, MONITORING_API_KEY
and MONITORING_CAMERA_ID are all configured. It exists so a plate detection can
also raise a realtime alert in the MonitoringAI dashboard.
"""
from __future__ import annotations

import json
import logging
import urllib.request
from datetime import datetime
from typing import Optional

from ..config import Settings


def is_enabled(settings: Settings) -> bool:
    """Service-level bridge enabled? (Per-camera id is supplied per event.)"""
    return bool(settings.monitoring_api_url and settings.monitoring_api_key)


def media_url(settings: Settings, image_path: str) -> Optional[str]:
    if not image_path:
        return None
    base = settings.monitoring_media_base_url
    if base:
        return f"{base.rstrip('/')}/{image_path}"
    api = settings.monitoring_api_url or ""
    if api.endswith("/api"):
        api = api[: -len("/api")]
    if api:
        return f"{api.rstrip('/')}/api/aicam-media/{image_path}"
    return None


def push_event(
    settings: Settings,
    logger: logging.Logger,
    *,
    event_type: str,
    confidence: float,
    image_path: Optional[str],
    event_time: Optional[datetime] = None,
    camera_id: Optional[str] = None,
) -> Optional[str]:
    """POST a generic event to MonitoringAI ``/api/events`` (x-api-key auth).

    ``event_type`` must be one of the backend's ``eventType`` enum values
    (INTRUSION, FIRE, SMOKE, PPE, FACE, VEHICLE).

    ``camera_id`` is the per-camera MonitoringAI id (multi-camera runtime);
    falls back to ``MONITORING_CAMERA_ID`` for the legacy single-camera path.

    Returns the MonitoringAI event id (needed to attach further evidence), or
    ``None`` when the push is disabled or failed. Truthiness is preserved for
    existing callers that only check success.
    """
    if not is_enabled(settings):
        return None

    target_camera = camera_id or settings.monitoring_camera_id
    if not target_camera:
        return None

    payload = {
        "cameraId": target_camera,
        "eventType": event_type,
        "confidence": max(0.0, min(1.0, float(confidence))),
        "timestamp": (event_time or datetime.utcnow()).isoformat(),
    }
    url = media_url(settings, image_path) if image_path else None
    if url:
        payload["imageUrl"] = url

    endpoint = f"{(settings.monitoring_api_url or '').rstrip('/')}/events"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-api-key": settings.monitoring_api_key or "",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            raw = resp.read()
            ok = 200 <= resp.status < 300
        if not ok:
            return None
        event_id = None
        try:
            parsed = json.loads(raw.decode("utf-8"))
            event_id = (parsed.get("data") or {}).get("id")
        except Exception:
            event_id = None
        logger.info("Pushed %s event to MonitoringAI (id=%s)", event_type, event_id)
        return event_id
    except Exception as exc:
        logger.warning("Failed to push %s event to MonitoringAI: %s", event_type, exc)
        return None


def post_evidence(
    settings: Settings,
    logger: logging.Logger,
    *,
    event_id: Optional[str],
    evidence_type: str,
    url: Optional[str],
    object_key: Optional[str] = None,
    sequence: Optional[int] = None,
    captured_at: Optional[datetime] = None,
    duration_ms: Optional[int] = None,
    metadata: Optional[dict] = None,
) -> bool:
    """Attach one evidence artifact (IMAGE or VIDEO) to an existing event.

    Requires ``MONITORING_API_URL`` + ``MONITORING_API_KEY`` and a known event id
    (from :func:`push_event`). Returns True when the row was created.
    """
    if not (settings.monitoring_api_url and settings.monitoring_api_key):
        return False
    if not event_id or not url:
        return False

    payload: dict = {"type": evidence_type, "url": url}
    if object_key:
        payload["objectKey"] = object_key
    if sequence is not None:
        payload["sequence"] = int(sequence)
    if captured_at is not None:
        payload["capturedAt"] = captured_at.isoformat()
    if duration_ms is not None:
        payload["durationMs"] = int(duration_ms)
    if metadata:
        payload["metadata"] = metadata

    endpoint = f"{(settings.monitoring_api_url or '').rstrip('/')}/events/{event_id}/evidence"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-api-key": settings.monitoring_api_key or "",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            ok = 200 <= resp.status < 300
        if ok:
            logger.info("Attached %s evidence to event %s", evidence_type, event_id)
        return ok
    except Exception as exc:
        logger.warning("Failed to attach %s evidence to event %s: %s", evidence_type, event_id, exc)
        return False


def fetch_runtime_config(settings: Settings, logger: logging.Logger) -> Optional[list]:
    """GET ``/api/ai/runtime-config`` (x-api-key).

    Returns the raw payload (parsed by :func:`app.core.camera_config.parse_runtime_config`)
    or ``None`` when disabled / unreachable. Never raises into the caller loop.
    """
    if not (settings.monitoring_api_url and settings.monitoring_api_key):
        return None
    url = f"{(settings.monitoring_api_url or '').rstrip('/')}/ai/runtime-config"
    req = urllib.request.Request(
        url, method="GET", headers={"x-api-key": settings.monitoring_api_key or ""}
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        logger.warning("Failed to fetch runtime config: %s", exc)
        return None


def push_vehicle_event(
    settings: Settings,
    logger: logging.Logger,
    *,
    confidence: float,
    image_path: Optional[str],
    event_time: Optional[datetime] = None,
) -> bool:
    """Backwards-compatible VEHICLE wrapper around :func:`push_event`."""
    return push_event(
        settings, logger,
        event_type="VEHICLE",
        confidence=confidence,
        image_path=image_path,
        event_time=event_time,
    )
