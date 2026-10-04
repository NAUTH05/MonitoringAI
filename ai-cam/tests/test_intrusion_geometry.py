"""Unit tests for the ROI geometry (no GPU / no neural network required)."""
from __future__ import annotations

import pytest

from app.tasks.intrusion.geometry import (
    MIN_POLYGON_POINTS,
    clamp_box,
    foot_point,
    normalize_polygon,
    point_in_polygon,
    polygon_area_px,
    polygon_to_pixel,
)

# A unit square occupying the middle 10%..90% of the frame.
SQUARE = [
    {"x": 0.1, "y": 0.1},
    {"x": 0.9, "y": 0.1},
    {"x": 0.9, "y": 0.9},
    {"x": 0.1, "y": 0.9},
]
W, H = 1280, 720


# ── normalized -> pixel conversion ────────────────────────────────────────
def test_normalized_to_pixel_exact():
    poly = normalize_polygon([{"x": 0.5, "y": 0.5}])
    assert poly is None  # 1 point is not a polygon

    poly = normalize_polygon(SQUARE)
    px = polygon_to_pixel(poly, W, H)
    assert px.shape == (4, 1, 2)
    # first vertex 0.1,0.1 -> 128,72
    assert px[0][0][0] == pytest.approx(0.1 * W)
    assert px[0][0][1] == pytest.approx(0.1 * H)
    # third vertex 0.9,0.9 -> 1152,648
    assert px[2][0][0] == pytest.approx(0.9 * W)
    assert px[2][0][1] == pytest.approx(0.9 * H)


def test_polygon_to_pixel_rejects_degenerate_frame():
    poly = normalize_polygon(SQUARE)
    assert polygon_to_pixel(poly, 0, H) is None
    assert polygon_to_pixel(poly, W, -1) is None


def test_normalize_polygon_accepts_compact_arrays():
    assert normalize_polygon([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]) == [
        (0.0, 0.0),
        (1.0, 0.0),
        (1.0, 1.0),
    ]


def test_normalize_polygon_clamps_out_of_range():
    poly = normalize_polygon([{"x": -0.5, "y": 2.0}, {"x": 1.5, "y": 0.5}, {"x": 0.2, "y": 0.2}])
    assert poly == [(0.0, 1.0), (1.0, 0.5), (0.2, 0.2)]


# ── empty / invalid ROI ───────────────────────────────────────────────────
def test_empty_roi_is_none_and_contains_nothing():
    assert normalize_polygon(None) is None
    assert normalize_polygon([]) is None
    assert point_in_polygon((640, 360), None) is False


def test_roi_with_fewer_than_three_points_is_invalid():
    assert MIN_POLYGON_POINTS == 3
    assert normalize_polygon([{"x": 0.1, "y": 0.1}]) is None
    assert normalize_polygon([{"x": 0.1, "y": 0.1}, {"x": 0.2, "y": 0.2}]) is None
    assert polygon_to_pixel([(0.1, 0.1), (0.2, 0.2)], W, H) is None


def test_malformed_roi_is_rejected():
    assert normalize_polygon("not-a-list") is None
    assert normalize_polygon([{"x": "a", "y": 0.1}, {"x": 0.2, "y": 0.2}, {"x": 0.3, "y": 0.3}]) is None


# ── point in polygon ──────────────────────────────────────────────────────
def test_point_clearly_inside():
    px = polygon_to_pixel(normalize_polygon(SQUARE), W, H)
    assert point_in_polygon((640, 360), px) is True


def test_point_clearly_outside():
    px = polygon_to_pixel(normalize_polygon(SQUARE), W, H)
    assert point_in_polygon((10, 10), px) is False
    assert point_in_polygon((1270, 710), px) is False


def test_point_on_edge_counts_as_inside():
    px = polygon_to_pixel(normalize_polygon(SQUARE), W, H)
    # left edge x=128, mid height
    assert point_in_polygon((128.0, 360.0), px) is True
    # top edge y=72, mid width
    assert point_in_polygon((640.0, 72.0), px) is True


def test_polygon_area():
    px = polygon_to_pixel(normalize_polygon(SQUARE), W, H)
    assert polygon_area_px(px) == pytest.approx((0.8 * W) * (0.8 * H))
    assert polygon_area_px(None) == 0.0


# ── foot point & box clamping ─────────────────────────────────────────────
def test_foot_point_is_bottom_center():
    assert foot_point([100, 200, 300, 500]) == (200.0, 500.0)
    assert foot_point([0, 0, 10, 10]) == (5.0, 10.0)


def test_clamp_box():
    assert clamp_box([-10, -10, 2000, 2000], W, H) == (0, 0, W - 1, H - 1)
    assert clamp_box([100, 100, 100, 300], W, H) is None  # zero width
