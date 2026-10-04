"""BaseTask — the contract between the AI task layer and the pipeline.

Kept intentionally small: a task owns inference and event semantics but NEVER
owns the camera connection (that is the job of ``app.sources``).

Event contract
--------------
* :attr:`event_type` — the MonitoringAI ``eventType`` pushed for this task
  (e.g. ``VEHICLE`` / ``INTRUSION``).
* :meth:`event_fields` — small JSON-serializable dict (must contain
  ``confidence`` when the task emits events).
* :meth:`event_images` — ``(main_image, thumbnail_or_None)``.
* :meth:`db_record` — optional kwargs for the AI-Cam events row, or ``None`` to
  skip the AI-Cam database entirely.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Optional, Tuple

import numpy as np


class BaseTask(ABC):
    name: str = "base"
    description: str = ""
    #: MonitoringAI event type pushed by this task (see backend eventType enum).
    event_type: str = "EVENT"
    #: When True the pipeline wraps the event in an EvidenceSession (snapshots +
    #: video) that accumulates evidence onto ONE event for the whole episode.
    supports_evidence_session: bool = False

    @abstractmethod
    def load(self) -> None:
        """Prepare resources. Called once at startup."""

    @abstractmethod
    def process(self, frame: np.ndarray, context: Optional[dict] = None) -> dict:
        """Run inference for a single frame and return a JSON-serializable dict."""

    def annotate(self, frame: np.ndarray, result: dict) -> np.ndarray:
        return frame

    def is_event(self, result: dict) -> bool:
        return False

    def session_active(self, result: dict) -> bool:
        """True while the episode is still ongoing (for evidence sessions).

        Only meaningful when :attr:`supports_evidence_session` is True: the
        pipeline uses it to decide when to stop snapshots / recording.
        """
        return False

    def event_fields(self, result: dict) -> Optional[dict]:
        return None

    def event_images(
        self, frame: np.ndarray, result: dict
    ) -> Optional[Tuple[np.ndarray, Optional[np.ndarray]]]:
        return None

    def db_record(
        self, fields: dict, image_key: str, thumbnail_key: Optional[str]
    ) -> Optional[dict]:
        """Kwargs for ``AicamEventWriter.write_event`` (minus stream/time/id).

        Default: write nothing to the AI-Cam database.
        """
        return None

    def status_extra(self) -> dict:
        """Optional task-specific fields merged into the status endpoint."""
        return {}
