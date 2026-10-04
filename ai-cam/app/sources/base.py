"""FrameSource interface shared by every capture backend."""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Optional

import numpy as np


class FrameSource(ABC):
    def __init__(self, logger: logging.Logger) -> None:
        self.logger = logger
        self._opened = False

    @property
    def is_open(self) -> bool:
        return self._opened

    @abstractmethod
    def open(self) -> bool:
        """Open the underlying device/stream. Returns True on success."""

    @abstractmethod
    def read(self) -> Optional[np.ndarray]:
        """Return the next BGR frame, or None on failure."""

    @abstractmethod
    def close(self) -> None:
        """Release the underlying device/stream."""

    def reconnect(self) -> bool:
        self.close()
        return self.open()

    @abstractmethod
    def describe(self) -> dict:
        """Human-readable source description for logs/status."""
