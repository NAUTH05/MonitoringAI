"""End-to-end ROI business-logic tests for IntrusionTask using a FAKE model.

No GPU / no YOLO weights are required: the fake detector returns synthetic
boxes so we can assert the enter / remain / leave / single-event / cooldown
behaviour deterministically.
"""
from __future__ import annotations

import logging
from types import SimpleNamespace

import numpy as np

from app.tasks.intrusion.task import IntrusionTask

FRAME = np.zeros((480, 640, 3), dtype=np.uint8)

# ROI = middle half of the frame: x in [160,480], y in [120,360].
ROI = [
    {"x": 0.25, "y": 0.25},
    {"x": 0.75, "y": 0.25},
    {"x": 0.75, "y": 0.75},
    {"x": 0.25, "y": 0.75},
]

INSIDE_BOX = [200, 200, 300, 300]   # foot (250, 300) -> inside
OUTSIDE_BOX = [10, 10, 60, 60]      # foot (35, 35)   -> outside


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


def _make_task(**overrides) -> IntrusionTask:
    model = FakePersonModel()
    registry = SimpleNamespace(
        person_model=model,
        person_names={0: "person"},
        yolo_predict_kwargs=lambda: {},
    )
    settings = SimpleNamespace(
        person_conf=0.35,
        min_inside_frames=2,
        intrusion_dwell_ms=0,
        event_cooldown_ms=0,
        roi_exit_frames=2,
        track_lost_frames=30,
        roi_polygon_inline=None,
    )
    for k, v in overrides.items():
        setattr(settings, k, v)
    provider = SimpleNamespace(current=lambda: ROI, describe=lambda: {"source": "test"})
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
    assert set(["trackId", "box", "confidence", "insideRoi", "footPoint"]).issubset(det)
    assert det["insideRoi"] is True
    assert det["footPoint"] == [250.0, 300.0]


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
