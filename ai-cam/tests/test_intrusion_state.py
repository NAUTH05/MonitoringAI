"""Unit tests for the per-track intrusion state machine."""
from __future__ import annotations

from app.tasks.intrusion.state import IntrusionConfig, IntrusionTracker, TrackState


def _tracker(**kw) -> IntrusionTracker:
    defaults = dict(
        person_conf=0.35,
        min_inside_frames=3,
        intrusion_dwell_ms=0,
        event_cooldown_ms=0,
        roi_exit_frames=2,
        track_lost_frames=30,
    )
    defaults.update(kw)
    return IntrusionTracker(IntrusionConfig(**defaults))


def test_no_event_before_debounce_completes():
    t = _tracker()
    assert t.tick(1, 0, {12: True})[12].emit is False
    assert t.tick(2, 10, {12: True})[12].emit is False


def test_event_fires_once_after_min_inside_frames():
    t = _tracker()
    t.tick(1, 0, {12: True})
    t.tick(2, 10, {12: True})
    d3 = t.tick(3, 20, {12: True})[12]
    assert d3.emit is True
    assert d3.state == TrackState.INSIDE


def test_person_remains_in_roi_does_not_refire():
    t = _tracker()
    emitted = [t.tick(i, i * 10, {12: True})[12].emit for i in range(1, 12)]
    assert emitted.count(True) == 1  # exactly one event while continuously inside
    assert t.state_of(12) == TrackState.INSIDE


def test_person_leaves_roi_and_reentry_refires():
    t = _tracker(min_inside_frames=1, roi_exit_frames=2)
    assert t.tick(1, 0, {12: True})[12].emit is True
    # still inside -> no repeat
    assert t.tick(2, 10, {12: True})[12].emit is False
    # outside, not yet enough to exit
    assert t.tick(3, 20, {12: False})[12].state == TrackState.INSIDE
    # second consecutive outside frame -> EXITED (re-armed)
    assert t.tick(4, 30, {12: False})[12].state == TrackState.EXITED
    # re-entry fires again
    assert t.tick(5, 40, {12: True})[12].emit is True


def test_dwell_time_is_respected():
    t = _tracker(min_inside_frames=1, intrusion_dwell_ms=1000)
    assert t.tick(1, 0, {1: True})[1].emit is False       # 0 ms dwell
    assert t.tick(2, 500, {1: True})[1].emit is False     # 500 ms dwell
    assert t.tick(3, 1200, {1: True})[1].emit is True     # >= 1000 ms


def test_event_cooldown_blocks_rapid_refire():
    t = _tracker(min_inside_frames=1, roi_exit_frames=1, event_cooldown_ms=10_000)
    assert t.tick(1, 0, {1: True})[1].emit is True        # last_event=0
    t.tick(2, 10, {1: False})                              # EXITED, re-armed
    assert t.tick(3, 20, {1: True})[1].emit is False      # cooldown 20 < 10000
    t.tick(4, 30, {1: False})                              # EXITED again
    assert t.tick(5, 20_000, {1: True})[1].emit is True   # cooldown elapsed


def test_independent_tracks():
    t = _tracker(min_inside_frames=1)
    d = t.tick(1, 0, {1: True, 2: False})
    assert d[1].emit is True
    assert d[2].emit is False
    assert t.state_of(1) == TrackState.INSIDE
    assert t.state_of(2) == TrackState.OUTSIDE


def test_stale_track_is_pruned():
    t = _tracker(track_lost_frames=5)
    t.tick(1, 0, {7: True})
    assert t.state_of(7) is not None
    t.tick(10, 0, {})  # 9 frames without seeing track 7 > 5
    assert t.state_of(7) is None


def test_reset_clears_state():
    t = _tracker()
    t.tick(1, 0, {1: True})
    t.reset()
    assert t.active_track_ids() == []
