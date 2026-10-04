"""Capture thread: owns the physical camera/stream and keeps a latest frame.

This is the ONLY component that reads the source, which guarantees a single
producer. The AI pipeline consumes frames from the shared buffer.
"""
from __future__ import annotations

import logging
import threading
import time

from ..sources.base import FrameSource
from .frame_buffer import LatestFrame


class CaptureThread(threading.Thread):
    def __init__(
        self,
        source: FrameSource,
        buffer: LatestFrame,
        logger: logging.Logger,
        reconnect_delay: float = 2.0,
        max_read_failures: int = 30,
    ) -> None:
        super().__init__(name="capture", daemon=True)
        self.source = source
        self.buffer = buffer
        self.logger = logger
        self.reconnect_delay = reconnect_delay
        self.max_read_failures = max_read_failures

        self._stop_event = threading.Event()
        self.frames_captured = 0
        self.read_failures = 0
        self.reconnects = 0
        self._ever_opened = False

    def run(self) -> None:
        while not self._stop_event.is_set():
            if not self.source.is_open:
                if not self.source.open():
                    self._stop_event.wait(self.reconnect_delay)
                    continue
                if self._ever_opened:
                    self.reconnects += 1
                self._ever_opened = True

            frame = self.source.read()
            if frame is None:
                self.read_failures += 1
                if self.read_failures >= self.max_read_failures:
                    self.logger.warning(
                        "Camera read failed %d times in a row; reconnecting",
                        self.read_failures,
                    )
                    self.source.reconnect()
                    self.read_failures = 0
                    self.reconnects += 1
                else:
                    self._stop_event.wait(0.02)
                continue

            self.read_failures = 0
            self.frames_captured += 1
            self.buffer.set(frame, time.time())

        self.source.close()
        self.logger.info("Capture thread stopped")

    def stop(self) -> None:
        self._stop_event.set()
