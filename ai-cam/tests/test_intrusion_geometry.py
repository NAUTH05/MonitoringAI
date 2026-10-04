"""Unit tests for the ROI geometry (no GPU / no neural network required)."""
from __future__ import annotations

import pytest

from app.tasks.intrusion.geometry import (
    MIN_POLYGON_POINTS,
    RoiMaskCache,
    box_roi_overlap_ratio,
    build_roi_mask,
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


# ── foot point & box clamping (foot point is DIAGNOSTIC ONLY) ─────────────
def test_foot_point_is_bottom_center():
    assert foot_point([100, 200, 300, 500]) == (200.0, 500.0)
    assert foot_point([0, 0, 10, 10]) == (5.0, 10.0)


def test_clamp_box():
    assert clamp_box([-10, -10, 2000, 2000], W, H) == (0, 0, W - 1, H - 1)
    assert clamp_box([100, 100, 100, 300], W, H) is None  # zero width


# ── bbox ∩ ROI overlap (the actual intrusion decision) ────────────────────
def _square_mask(w=W, h=H):
    """Binary mask of the SQUARE ROI (middle 10%..90%) for a frame size."""
    px = polygon_to_pixel(normalize_polygon(SQUARE), w, h)
    return build_roi_mask(px, w, h)


def test_overlap_bbox_completely_outside_is_zero():
    mask = _square_mask()
    assert box_roi_overlap_ratio([10, 10, 60, 60], mask, W, H) == pytest.approx(0.0)


def test_overlap_bbox_completely_inside_is_one():
    mask = _square_mask()
    assert box_roi_overlap_ratio([200, 200, 300, 300], mask, W, H) == pytest.approx(1.0)


def test_overlap_bbox_half_inside_is_half():
    mask = _square_mask()
    # Box [28..228] straddles the ROI left edge x=128: 100 of 200 px wide -> 0.5.
    # Denominator is the PERSON BBOX area, so this is 0.5 (NOT the tiny IoU).
    assert box_roi_overlap_ratio([28, 200, 228, 300], mask, W, H) == pytest.approx(0.5, abs=0.01)


def test_overlap_bbox_touching_edge_only_is_near_zero():
    mask = _square_mask()
    # Right edge of the box coincides with the ROI left edge x=128 -> ~0.
    assert box_roi_overlap_ratio([28, 200, 128, 300], mask, W, H) == pytest.approx(0.0, abs=0.02)


def test_overlap_denominator_is_bbox_area_not_roi_area():
    # ROI = LEFT HALF of the frame. A box straddling x=640 is 50% inside the ROI.
    left_half = [{"x": 0.0, "y": 0.0}, {"x": 0.5, "y": 0.0}, {"x": 0.5, "y": 1.0}, {"x": 0.0, "y": 1.0}]
    mask = build_roi_mask(polygon_to_pixel(normalize_polygon(left_half), W, H), W, H)
    # 100 of the box's 200 px width is inside -> 0.5. (IoU against the huge ROI
    # would be ~0.02, so this also proves the denominator is the BBOX area.)
    assert box_roi_overlap_ratio([540, 200, 740, 300], mask, W, H) == pytest.approx(0.5, abs=0.01)


def test_overlap_empty_or_invalid_roi_is_zero():
    assert box_roi_overlap_ratio([10, 10, 60, 60], None, W, H) == 0.0
    assert build_roi_mask(None, W, H) is None
    assert build_roi_mask(polygon_to_pixel([(0.1, 0.1), (0.2, 0.2)], W, H), W, H) is None


def test_overlap_degenerate_and_tiny_boxes():
    mask = _square_mask()
    assert box_roi_overlap_ratio([100, 100, 100, 300], mask, W, H) == 0.0   # zero width
    assert box_roi_overlap_ratio([200, 200, 201, 201], mask, W, H) == pytest.approx(1.0)  # tiny, inside
    assert box_roi_overlap_ratio([10, 10, 11, 11], mask, W, H) == pytest.approx(0.0)      # tiny, outside


# Non-convex L-shaped polygon (normalized) on a 1000x1000 frame. The top-right
# rectangle x[500,900] y[100,500] is the concave NOTCH (outside the polygon).
L_SHAPE = [
    {"x": 0.1, "y": 0.1},
    {"x": 0.5, "y": 0.1},
    {"x": 0.5, "y": 0.5},
    {"x": 0.9, "y": 0.5},
    {"x": 0.9, "y": 0.9},
    {"x": 0.1, "y": 0.9},
]


def _l_mask(size=1000):
    px = polygon_to_pixel(normalize_polygon(L_SHAPE), size, size)
    return build_roi_mask(px, size, size)


def test_overlap_non_convex_polygon():
    mask = _l_mask()
    # Inside the concave notch -> OUTSIDE the polygon (a convex-hull test would
    # wrongly say "inside").
    assert box_roi_overlap_ratio([600, 200, 800, 400], mask, 1000, 1000) == pytest.approx(0.0)
    # Inside the left arm -> fully inside.
    assert box_roi_overlap_ratio([200, 200, 400, 400], mask, 1000, 1000) == pytest.approx(1.0)


def test_overlap_bbox_clamped_against_frame_edge():
    mask = _l_mask()
    # Partly off-frame box -> clamped, no crash, sensible ratio (~0.25).
    r = box_roi_overlap_ratio([-50, -50, 200, 200], mask, 1000, 1000)
    assert 0.0 < r < 1.0
    assert r == pytest.approx(0.25, abs=0.02)


# ── mask cache ────────────────────────────────────────────────────────────
def test_roi_mask_cache_reuses_and_invalidates():
    cache = RoiMaskCache(normalize_polygon(SQUARE))
    m1 = cache.mask(W, H)
    assert cache.mask(W, H) is m1                      # reused (same ROI + size)
    m2 = cache.mask(640, 360)
    assert m2 is not m1 and m2.shape == (360, 640)     # rebuilt on size change
    cache.set_polygon(normalize_polygon([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]))
    assert cache.mask(W, H) is not m1                  # rebuilt on ROI change
    assert cache.overlap_ratio([200, 200, 300, 300], W, H) >= 0.0


def test_roi_mask_cache_without_polygon_is_zero():
    cache = RoiMaskCache()
    assert cache.mask(W, H) is None
    assert cache.overlap_ratio([10, 10, 60, 60], W, H) == 0.0
