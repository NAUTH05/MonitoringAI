"""Build a frame source for one camera.

The source is chosen from the per-camera :class:`CameraRuntimeConfig`, not from
global env. Two kinds exist:

* ``rtsp``   — any network stream URL (direct IP camera, NVR channel, or the
               go2rtc re-stream ``rtsp://<host>:8554/<stream>``). This is the
               production path and is what the runtime-config endpoint supplies.
* ``webcam`` — a device attached to the machine running AI-Cam (development
               only). Used by the legacy single-camera fallback.
"""
from __future__ import annotations

import logging

from ..config import Settings
from .base import FrameSource
from .opencv_source import OpenCvSource


def create_source_for(runtime, settings: Settings, logger: logging.Logger) -> FrameSource:
    """Build the frame source for one camera runtime config."""
    if runtime.source_type == "webcam":
        return OpenCvSource(
            logger,
            kind="webcam",
            device=runtime.webcam_device,
            backend=settings.webcam_backend,
            width=settings.webcam_width,
            height=settings.webcam_height,
            fps=settings.webcam_fps,
        )

    if not runtime.ai_source_url:
        raise ValueError(
            f"camera '{runtime.name}' has no ai source url "
            "(set Camera.aiSourceUrl or streamName)"
        )
    return OpenCvSource(
        logger,
        kind="rtsp",
        url=runtime.ai_source_url,
        rtsp_transport=settings.rtsp_transport,
    )
