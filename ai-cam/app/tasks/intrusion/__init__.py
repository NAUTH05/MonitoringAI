"""INTRUSION task package: person detection + ROI business logic."""
from .geometry import (
    MIN_POLYGON_POINTS,
    RoiMaskCache,
    box_roi_overlap_ratio,
    build_roi_mask,
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
    "RoiMaskCache",
    "build_roi_mask",
    "box_roi_overlap_ratio",
    "normalize_polygon",
    "polygon_to_pixel",
    "point_in_polygon",
    "polygon_area_px",
    "foot_point",
    "MIN_POLYGON_POINTS",
]
