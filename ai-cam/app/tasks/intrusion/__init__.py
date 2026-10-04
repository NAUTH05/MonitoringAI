"""INTRUSION task package: person detection + ROI business logic."""
from .geometry import (
    MIN_POLYGON_POINTS,
    foot_point,
    normalize_polygon,
    point_in_polygon,
    polygon_area_px,
    polygon_to_pixel,
)
from .state import Decision, IntrusionConfig, IntrusionTracker, TrackState
from .task import IntrusionTask

__all__ = [
    "IntrusionTask",
    "IntrusionConfig",
    "IntrusionTracker",
    "TrackState",
    "Decision",
    "normalize_polygon",
    "polygon_to_pixel",
    "point_in_polygon",
    "polygon_area_px",
    "foot_point",
    "MIN_POLYGON_POINTS",
]
