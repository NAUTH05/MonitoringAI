"""Build the configured frame source.

Supported ``CAMERA_SOURCE_TYPE`` values:
    - ``webcam`` : built-in/attached camera by index (development)
    - ``rtsp``   : direct IP camera / NVR RTSP URL (production target)
    - ``go2rtc`` : the go2rtc re-stream, consumed over RTSP. Use this to share a
                   single physical capture between MonitoringAI and AI-Cam.
"""
from __future__ import annotations

import logging

from ..config import Settings
from .base import FrameSource
from .opencv_source import OpenCvSource


def create_source(settings: Settings, logger: logging.Logger) -> FrameSource:
    source_type = settings.source_type
    if source_type == "webcam":
        return OpenCvSource(
            logger,
            kind="webcam",
            device=settings.webcam_device,
            backend=settings.webcam_backend,
            width=settings.webcam_width,
            height=settings.webcam_height,
            fps=settings.webcam_fps,
        )
    if source_type in ("rtsp", "go2rtc", "http"):
        if not settings.camera_url:
            raise ValueError(
                f"CAMERA_SOURCE_TYPE={source_type} requires CAMERA_URL to be set"
            )
        return OpenCvSource(
            logger,
            kind="rtsp",
            url=settings.camera_url,
            rtsp_transport=settings.rtsp_transport,
        )
    raise ValueError(
        f"Unsupported CAMERA_SOURCE_TYPE='{source_type}'. "
        "Use 'webcam', 'rtsp' or 'go2rtc'."
    )
