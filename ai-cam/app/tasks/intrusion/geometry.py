"""ROI geometry for the INTRUSION task.

Coordinate contract (must stay identical to the MonitoringAI ROI editor)
-----------------------------------------------------------------------
* ``CameraModule.config.roiPolygon`` is a list of NORMALIZED points::

      [{"x": 0.1234, "y": 0.2345}, ...]     0.0 <= x, y <= 1.0

  They are relative to the **video content** (the decoded frame), never to the
  player container / letterbox padding.

* At inference time the polygon is converted to PIXEL coordinates using the
  REAL decoded frame size::

      px = normalized_x * frame_width
      py = normalized_y * frame_height

* A person's ground-contact point is the BOTTOM-CENTER of its bounding box
  (restricted zones represent areas on the *ground*, not the bbox centre)::

      foot_x = (x1 + x2) / 2
      foot_y = y2

Everything in this module is pure (no models, no I/O) so it can be unit-tested
without a GPU or a neural network.
"""
from __future__ import annotations

from typing import Any, Iterable, List, Optional, Sequence, Tuple

import cv2
import numpy as np

Point = Tuple[float, float]

#: Minimum number of vertices for a valid polygon (a triangle).
MIN_POLYGON_POINTS = 3


def normalize_polygon(raw: Any) -> Optional[List[Point]]:
    """Validate/convert a raw ROI polygon into ``[(x, y), ...]`` normalized.

    Accepts the two shapes the frontend and JSON files may use:

    * ``[{"x": 0.1, "y": 0.2}, ...]``  (stored config)
    * ``[[0.1, 0.2], ...]``            (compact)

    Returns ``None`` when the polygon is missing, malformed, or has fewer than
    :data:`MIN_POLYGON_POINTS` points (an "empty"/invalid ROI means "no
    restricted zone", never "the whole frame"). Values are clamped to
    ``[0, 1]`` defensively.
    """
    if raw is None:
        return None
    if not isinstance(raw, (list, tuple)):
        return None
    if len(raw) < MIN_POLYGON_POINTS:
        return None

    points: List[Point] = []
    for item in raw:
        if isinstance(item, dict):
            x, y = item.get("x"), item.get("y")
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            x, y = item[0], item[1]
        else:
            return None
        try:
            fx, fy = float(x), float(y)
        except (TypeError, ValueError):
            return None
        if not (np.isfinite(fx) and np.isfinite(fy)):
            return None
        points.append((min(1.0, max(0.0, fx)), min(1.0, max(0.0, fy))))
    return points


def polygon_to_pixel(
    points: Sequence[Point], width: int, height: int
) -> Optional[np.ndarray]:
    """Convert a normalized polygon to pixel coordinates for a frame.

    Returns an ``(N, 1, 2)`` float32 array (the shape ``cv2`` expects) or
    ``None`` when the polygon is invalid or the frame size is degenerate.
    """
    if not points or len(points) < MIN_POLYGON_POINTS:
        return None
    if width <= 0 or height <= 0:
        return None
    arr = np.array(
        [[[px * float(width), py * float(height)]] for px, py in points],
        dtype=np.float32,
    )
    return arr


def foot_point(box: Iterable[float]) -> Point:
    """Ground-contact point of a bbox ``[x1, y1, x2, y2]``: bottom-center."""
    x1, y1, x2, y2 = (float(v) for v in box)
    return ((x1 + x2) / 2.0, y2)


def point_in_polygon(point: Point, polygon_px: Optional[np.ndarray]) -> bool:
    """Return True when ``point`` is inside or ON the edge of the polygon.

    Uses ``cv2.pointPolygonTest`` (returns >0 inside, 0 on the edge, <0
    outside). A point exactly on the boundary counts as inside — that matches
    the usual "the person has reached the zone" semantics and keeps behaviour
    deterministic for the edge unit test.

    An empty/``None`` polygon never contains a point.
    """
    if polygon_px is None or len(polygon_px) < MIN_POLYGON_POINTS:
        return False
    px, py = float(point[0]), float(point[1])
    result = cv2.pointPolygonTest(polygon_px, (px, py), False)
    return result >= 0.0


def polygon_area_px(polygon_px: Optional[np.ndarray]) -> float:
    """Absolute area of a pixel polygon (0.0 when invalid)."""
    if polygon_px is None or len(polygon_px) < MIN_POLYGON_POINTS:
        return 0.0
    pts = polygon_px.reshape(-1, 2).astype(np.float32)
    return float(abs(cv2.contourArea(pts)))


def clamp_box(box: Iterable[float], width: int, height: int) -> Optional[Tuple[int, int, int, int]]:
    """Clamp ``[x1, y1, x2, y2]`` to the frame and return integer coords.

    Returns ``None`` for degenerate boxes.
    """
    x1, y1, x2, y2 = (float(v) for v in box)
    x1 = int(max(0, min(width - 1, x1)))
    y1 = int(max(0, min(height - 1, y1)))
    x2 = int(max(0, min(width - 1, x2)))
    y2 = int(max(0, min(height - 1, y2)))
    if x2 <= x1 or y2 <= y1:
        return None
    return x1, y1, x2, y2
