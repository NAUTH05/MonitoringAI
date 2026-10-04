"""OpenCV-backed capture for laptop webcams and RTSP cameras.

``cv2`` is already a dependency of ultralytics, so no extra native library is
required. On Windows the webcam is opened through DirectShow (CAP_DSHOW),
which is the most reliable backend for built-in laptop cameras.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import cv2
import numpy as np

from .base import FrameSource

_BACKENDS = {
    "dshow": cv2.CAP_DSHOW,
    "msmf": cv2.CAP_MSMF,
    "any": cv2.CAP_ANY,
}


class OpenCvSource(FrameSource):
    """Captures frames from a webcam index or an RTSP/HTTP URL."""

    def __init__(
        self,
        logger: logging.Logger,
        *,
        kind: str,
        url: str = "",
        device: int = 0,
        backend: str = "dshow",
        width: int = 1280,
        height: int = 720,
        fps: int = 30,
        rtsp_transport: str = "tcp",
    ) -> None:
        super().__init__(logger)
        self.kind = kind
        self.url = url
        self.device = device
        self.backend = backend
        self.width = width
        self.height = height
        self.fps = fps
        self.rtsp_transport = rtsp_transport
        self._cap: Optional[cv2.VideoCapture] = None

    def open(self) -> bool:
        if self.kind == "webcam":
            return self._open_webcam()
        return self._open_url()

    def _open_webcam(self) -> bool:
        backend = _BACKENDS.get(self.backend, cv2.CAP_DSHOW)
        cap = cv2.VideoCapture(self.device, backend)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        cap.set(cv2.CAP_PROP_FPS, self.fps)
        try:
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        except Exception:
            pass
        if not cap.isOpened():
            cap.release()
            self.logger.error("Webcam device %s could not be opened (backend=%s)", self.device, self.backend)
            self._opened = False
            return False
        self._cap = cap
        self._opened = True
        self.logger.info(
            "Webcam opened: device=%s backend=%s target=%dx%d@%d",
            self.device, self.backend, self.width, self.height, self.fps,
        )
        return True

    def _open_url(self) -> bool:
        if not self.url:
            self.logger.error("No CAMERA_URL configured for %s source", self.kind)
            return False
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
            f"rtsp_transport;{self.rtsp_transport}|fflags;discardcorrupt"
        )
        cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if not cap.isOpened():
            cap.release()
            self.logger.error("Stream could not be opened: %s", self.url)
            self._opened = False
            return False
        self._cap = cap
        self._opened = True
        self.logger.info("Stream opened: %s (transport=%s)", self.url, self.rtsp_transport)
        return True

    def read(self) -> Optional[np.ndarray]:
        if self._cap is None:
            return None
        ok, frame = self._cap.read()
        if not ok or frame is None or frame.size == 0:
            return None
        return frame

    def close(self) -> None:
        if self._cap is not None:
            try:
                self._cap.release()
            except Exception:
                pass
        self._cap = None
        self._opened = False

    def describe(self) -> dict:
        if self.kind == "webcam":
            target = f"webcam:{self.device}"
        else:
            target = self.url
        return {"kind": self.kind, "target": target, "backend": self.backend}
