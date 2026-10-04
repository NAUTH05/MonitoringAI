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
    return bool(
        settings.monitoring_api_url
        and settings.monitoring_api_key
        and settings.monitoring_camera_id
    )


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
) -> bool:
    """POST a generic event to MonitoringAI ``/api/events`` (x-api-key auth).

    ``event_type`` must be one of the backend's ``eventType`` enum values
    (INTRUSION, FIRE, SMOKE, PPE, FACE, VEHICLE).
    """
    if not is_enabled(settings):
        return False

    payload = {
        "cameraId": settings.monitoring_camera_id,
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
            ok = 200 <= resp.status < 300
        if ok:
            logger.info("Pushed %s event to MonitoringAI", event_type)
        return ok
    except Exception as exc:
        logger.warning("Failed to push %s event to MonitoringAI: %s", event_type, exc)
        return False


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
