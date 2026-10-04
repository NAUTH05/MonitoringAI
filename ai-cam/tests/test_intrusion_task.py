"""End-to-end ROI business-logic tests for IntrusionTask using a FAKE model.

No GPU / no YOLO weights are required: the fake detector returns synthetic
boxes so we can assert the enter / remain / leave / single-event / cooldown
behaviour deterministically.
"""
from __future__ import annotations

import logging
from types import SimpleNamespace

import numpy as np
import pytest

from app.tasks.intrusion.task import IntrusionTask

FRAME = np.zeros((480, 640, 3), dtype=np.uint8)

# ROI = middle half of the frame: x in [160,480], y in [120,360].
ROI = [
    {"x": 0.25, "y": 0.25},
    {"x": 0.75, "y": 0.25},
    {"x": 0.75, "y": 0.75},
    {"x": 0.25, "y": 0.75},
]

# insideRoi is decided by the fraction of the PERSON BBOX inside the ROI.
INSIDE_BOX = [200, 200, 300, 300]    # fully inside  -> roiOverlap 1.00
OUTSIDE_BOX = [10, 10, 60, 60]       # fully outside -> roiOverlap 0.00
PARTIAL_BOX = [110, 200, 210, 300]   # straddles x=160 -> 50/100 = 0.50
BELOW_BOX = [70, 200, 170, 300]      # straddles x=160 -> 10/100 = 0.10 (< 0.15)
AT_BOX = [75, 200, 175, 300]         # straddles x=160 -> 15/100 = 0.15 (== threshold)

# ROI covering only the UPPER part of the frame (y in [96,240]).
ROI_TOP = [
    {"x": 0.25, "y": 0.20},
    {"x": 0.75, "y": 0.20},
    {"x": 0.75, "y": 0.50},
    {"x": 0.25, "y": 0.50},
]
# Person whose FEET are well below the ROI (foot y=420 > 240) but whose body
# still overlaps it: rows 180..239 of a 240-row box -> 0.25.
BODY_OVERLAP_BOX = [200, 180, 300, 420]


class _T:
    """Minimal stand-in for a torch tensor (.int()/.cpu()/.tolist())."""

    def __init__(self, arr):
        self._a = np.asarray(arr)

    def int(self):
        return _T(self._a.astype(np.int64))

    def cpu(self):
        return self

    def tolist(self):
        return self._a.tolist()


class _Boxes:
    def __init__(self, boxes, ids, confs):
        self.xyxy = _T(boxes)
        self.id = None if ids is None else _T(ids)
        self.conf = _T(confs)


class _Result:
    def __init__(self, boxes):
        self.boxes = boxes


class FakePersonModel:
    def __init__(self):
        self._boxes = _Boxes([], None, [])

    def set(self, boxes, ids, confs):
        self._boxes = _Boxes(boxes, ids, confs)

    def track(self, frame, **kwargs):  # noqa: ARG002
        return [_Result(self._boxes)]


def _make_task(roi=None, **overrides) -> IntrusionTask:
    roi = ROI if roi is None else roi
    model = FakePersonModel()
    registry = SimpleNamespace(
        person_model=model,
        person_names={0: "person"},
        yolo_predict_kwargs=lambda: {},
    )
    settings = SimpleNamespace(
        person_conf=0.35,
        overlap_threshold=0.15,
        min_inside_frames=2,
        intrusion_dwell_ms=0,
        event_cooldown_ms=0,
        roi_exit_frames=2,
        track_lost_frames=30,
        roi_polygon_inline=None,
    )
    for k, v in overrides.items():
        setattr(settings, k, v)
    provider = SimpleNamespace(current=lambda: roi, describe=lambda: {"source": "test"})
    task = IntrusionTask(registry, settings, logging.getLogger("test"), roi_provider=provider)
    task.load()
    return task


def _feed(task: IntrusionTask, box, track_id=1, conf=0.9):
    task.registry.person_model.set([box], [track_id], [conf])
    return task.process(FRAME)


def test_detection_payload_shape():
    task = _make_task()
    res = _feed(task, INSIDE_BOX)
    assert res["count"] == 1
    det = res["detections"][0]
    # The payload is bbox-overlap driven; footPoint is not required.
    assert set(["trackId", "box", "confidence", "roiOverlap", "insideRoi", "state"]).issubset(det)
    assert det["insideRoi"] is True
    assert det["roiOverlap"] == 1.0


# ── bbox ∩ ROI overlap threshold behaviour ────────────────────────────────
def test_overlap_completely_outside_and_inside():
    task = _make_task()
    assert _feed(task, OUTSIDE_BOX)["detections"][0]["roiOverlap"] == 0.0
    assert _feed(task, INSIDE_BOX)["detections"][0]["roiOverlap"] == 1.0


def test_overlap_below_threshold_is_outside():
    task = _make_task()
    det = _feed(task, BELOW_BOX)["detections"][0]
    assert det["roiOverlap"] == pytest.approx(0.10, abs=0.01)
    assert det["insideRoi"] is False
    assert _feed(task, BELOW_BOX)["violation"] is False


def test_overlap_exactly_threshold_is_inside():
    task = _make_task()
    det = _feed(task, AT_BOX)["detections"][0]
    assert det["roiOverlap"] == pytest.approx(0.15, abs=0.005)
    assert det["insideRoi"] is True


def test_overlap_above_threshold_is_inside():
    task = _make_task()
    det = _feed(task, PARTIAL_BOX)["detections"][0]
    assert det["roiOverlap"] == pytest.approx(0.50, abs=0.01)
    assert det["insideRoi"] is True


def test_threshold_is_configurable():
    # A high threshold makes the same 0.5-overlap box count as OUTSIDE.
    task = _make_task(overlap_threshold=0.6)
    det = _feed(task, PARTIAL_BOX)["detections"][0]
    assert det["roiOverlap"] == pytest.approx(0.50, abs=0.01)
    assert det["insideRoi"] is False


def test_feet_outside_roi_but_body_overlaps_fires():
    task = _make_task(roi=ROI_TOP)
    r1 = _feed(task, BODY_OVERLAP_BOX)
    det = r1["detections"][0]
    # The foot point (250, 420) is BELOW the ROI, yet the body overlaps it.
    assert det["roiOverlap"] == pytest.approx(0.25, abs=0.02)
    assert det["insideRoi"] is True
    assert r1["violation"] is False                       # debounce (2 frames)
    assert _feed(task, BODY_OVERLAP_BOX)["violation"] is True


def test_multiple_people_with_different_overlap():
    task = _make_task()
    task.registry.person_model.set(
        [INSIDE_BOX, PARTIAL_BOX, OUTSIDE_BOX], [1, 2, 3], [0.9, 0.8, 0.7]
    )
    by_id = {d["trackId"]: d for d in task.process(FRAME)["detections"]}
    assert by_id[1]["insideRoi"] is True and by_id[1]["roiOverlap"] == 1.0
    assert by_id[2]["insideRoi"] is True and by_id[2]["roiOverlap"] == pytest.approx(0.50, abs=0.01)
    assert by_id[3]["insideRoi"] is False and by_id[3]["roiOverlap"] == 0.0


def test_person_enters_roi_fires_once():
    task = _make_task()
    r1 = _feed(task, INSIDE_BOX)          # frame 1 -> debounce not met
    assert r1["violation"] is False
    r2 = _feed(task, INSIDE_BOX)          # frame 2 -> confirmed
    assert r2["violation"] is True
    assert len(r2["new_violations"]) == 1
    assert task.is_event(r2) is True


def test_person_remains_in_roi_no_extra_event():
    task = _make_task()
    _feed(task, INSIDE_BOX)
    _feed(task, INSIDE_BOX)
    for _ in range(5):
        r = _feed(task, INSIDE_BOX)
        assert r["violation"] is False


def test_person_leaves_roi_then_reentry_fires_again():
    task = _make_task()
    _feed(task, INSIDE_BOX)
    assert _feed(task, INSIDE_BOX)["violation"] is True
    _feed(task, OUTSIDE_BOX)              # outside_frames = 1
    r = _feed(task, OUTSIDE_BOX)          # outside_frames = 2 -> EXITED
    assert r["detections"][0]["state"] == "EXITED"
    _feed(task, INSIDE_BOX)               # re-entry frame 1 -> debounce
    assert _feed(task, INSIDE_BOX)["violation"] is True  # re-entry fires again


def test_no_roi_never_fires():
    task = _make_task()
    task.roi_provider = SimpleNamespace(current=lambda: None, describe=lambda: {})
    for _ in range(5):
        r = _feed(task, INSIDE_BOX)
    assert r["violation"] is False
    assert r["detections"][0]["insideRoi"] is False


def test_event_fields_and_images():
    task = _make_task()
    _feed(task, INSIDE_BOX)
    result = _feed(task, INSIDE_BOX)
    fields = task.event_fields(result)
    assert fields["confidence"] == 0.9
    assert fields["track_id"] == 1
    assert fields["roi_overlap"] == 1.0
    images = task.event_images(FRAME, result)
    assert images is not None
    annotated, thumb = images
    assert annotated.shape == FRAME.shape
    assert thumb is None


def test_annotate_does_not_mutate_input():
    task = _make_task()
    result = _feed(task, INSIDE_BOX)
    before = FRAME.copy()
    out = task.annotate(FRAME, result)
    assert np.array_equal(FRAME, before)
    assert out.shape == FRAME.shape
