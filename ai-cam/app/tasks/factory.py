"""Task factory — maps ``AI_TASK_NAME`` to a task implementation.

Keeps the pipeline task-agnostic: adding a new AI task means adding a branch
here plus a new ``app/tasks/<name>/`` package, nothing else.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from ..config import Settings
from .base import BaseTask
from .license_plate.task import LicensePlateTask

#: Accepted aliases for ``AI_TASK_NAME`` (lower-cased).
_ALIASES = {
    "license_plate": "license_plate",
    "anpr": "license_plate",
    "plate": "license_plate",
    "intrusion": "intrusion",
    "restricted_zone": "intrusion",
    "person": "intrusion",
}

#: Tasks that use the person detector instead of the vehicle/plate/OCR stack.
PERSON_TASKS = {"intrusion"}


def resolve_task_name(task_name: str) -> str:
    key = (task_name or "").strip().lower()
    resolved = _ALIASES.get(key)
    if resolved is None:
        raise ValueError(
            f"Unknown AI_TASK_NAME='{task_name}'. "
            f"Supported: {', '.join(sorted(set(_ALIASES.values())))}"
        )
    return resolved


def create_task(
    settings: Settings,
    registry: Any,
    logger: logging.Logger,
    roi_provider: Optional[Any] = None,
) -> BaseTask:
    name = resolve_task_name(settings.task_name)
    if name == "intrusion":
        from .intrusion.task import IntrusionTask

        return IntrusionTask(registry, settings, logger, roi_provider=roi_provider)
    return LicensePlateTask(registry, settings, logger)
