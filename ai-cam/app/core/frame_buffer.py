"""Single-slot, thread-safe 'latest frame' buffer.

The capture thread always overwrites the slot with the newest frame; consumers
never block and always get the freshest available frame. This is what lets the
camera preview run at its native FPS while AI inference runs slower without
building up latency.
"""
from __future__ import annotations

import threading
from typing import Optional, Tuple

import numpy as np


class LatestFrame:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._frame: Optional[np.ndarray] = None
        self._timestamp: float = 0.0
        self._sequence: int = 0

    def set(self, frame: np.ndarray, timestamp: float) -> None:
        with self._lock:
            self._frame = frame
            self._timestamp = timestamp
            self._sequence += 1

    def get(self) -> Tuple[Optional[np.ndarray], float, int]:
        with self._lock:
            return self._frame, self._timestamp, self._sequence
