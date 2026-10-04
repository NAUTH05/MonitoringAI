"""Per-track intrusion state machine.

An INTRUSION event is *not* produced on every frame a person is inside the
ROI. Instead each ByteTrack track id carries a small state machine::

    OUTSIDE ──enter──▶ ENTERING ──confirmed──▶ INSIDE ──left──▶ EXITED
                          ▲                                     │
                          └────────────── re-enter ─────────────┘

* ``ENTERING`` must survive ``min_inside_frames`` consecutive processed frames
  AND ``intrusion_dwell_ms`` of wall-clock dwell before it is promoted to
  ``INSIDE`` and a single event is emitted.
* While the track stays ``INSIDE`` no further event is emitted (one event per
  entry episode).
* The track is re-armed only after it has been outside for ``roi_exit_frames``
  consecutive frames (``EXITED``), so a person who steps out and back in fires
  again.
* ``event_cooldown_ms`` is an additional guard against rapid re-fires on the
  same track.

The single boolean fed in per track is ``bbox∩ROI overlap ratio >= threshold``
(see :mod:`app.tasks.intrusion.geometry`); this module never looks at points.

This module is pure Python (no numpy/cv2/models) so it is fully unit-testable.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Optional


class TrackState(str, Enum):
    OUTSIDE = "OUTSIDE"
    ENTERING = "ENTERING"
    INSIDE = "INSIDE"
    EXITED = "EXITED"


@dataclass
class IntrusionConfig:
    """Runtime thresholds — all configurable, no magic constants in the task."""

    person_conf: float = 0.35
    #: Minimum fraction of the person bbox that must overlap the ROI before the
    #: person counts as "inside" for the state machine. See INTRUSION_OVERLAP_THRESHOLD.
    overlap_threshold: float = 0.15
    min_inside_frames: int = 3
    intrusion_dwell_ms: int = 1000
    event_cooldown_ms: int = 5000
    roi_exit_frames: int = 5
    track_lost_frames: int = 30

    def __post_init__(self) -> None:
        # Keep the overlap threshold inside [0.0, 1.0] no matter how it was supplied.
        self.overlap_threshold = min(1.0, max(0.0, float(self.overlap_threshold)))

    @classmethod
    def from_settings(cls, settings) -> "IntrusionConfig":
        return cls(
            person_conf=float(settings.person_conf),
            overlap_threshold=float(getattr(settings, "overlap_threshold", 0.15)),
            min_inside_frames=int(settings.min_inside_frames),
            intrusion_dwell_ms=int(settings.intrusion_dwell_ms),
            event_cooldown_ms=int(settings.event_cooldown_ms),
            roi_exit_frames=int(settings.roi_exit_frames),
            track_lost_frames=int(settings.track_lost_frames),
        )


@dataclass
class Decision:
    """Outcome of a state-machine update for a single track on one frame."""

    emit: bool
    state: TrackState
    inside_frames: int = 0
    inside_ms: float = 0.0


@dataclass
class _TrackRecord:
    state: TrackState = TrackState.OUTSIDE
    inside_frames: int = 0
    outside_frames: int = 0
    first_inside_ms: Optional[float] = None
    last_event_ms: Optional[float] = None
    last_seen_frame: int = 0
    armed: bool = True
    total_events: int = 0
    #: Monotonic (frame-index based) timestamp of the most recent confirmation.
    confirmed_frame: Optional[int] = None


class IntrusionTracker:
    """Holds the per-track state and decides when an event should fire."""

    def __init__(self, config: IntrusionConfig) -> None:
        self.config = config
        self._tracks: Dict[int, _TrackRecord] = {}

    # ── public API ────────────────────────────────────────────────────────
    def tick(
        self,
        frame_index: int,
        now_ms: float,
        observations: Dict[int, bool],
    ) -> Dict[int, Decision]:
        """Advance every observed track by one frame.

        ``observations`` maps ``track_id -> inside_roi``, where ``inside_roi`` is
        ``roi_overlap_ratio >= overlap_threshold`` (bbox∩ROI overlap — NOT a foot
        point test). Returns ``track_id -> Decision`` for the observed tracks
        only. Stale tracks (not seen for ``track_lost_frames``) are pruned.
        """
        decisions: Dict[int, Decision] = {}
        for track_id, inside in observations.items():
            rec = self._tracks.get(track_id)
            if rec is None:
                rec = _TrackRecord()
                self._tracks[track_id] = rec
            rec.last_seen_frame = frame_index
            decisions[track_id] = self._advance(rec, inside, now_ms, frame_index)

        self._prune(frame_index)
        return decisions

    def state_of(self, track_id: int) -> Optional[TrackState]:
        rec = self._tracks.get(track_id)
        return rec.state if rec else None

    def active_track_ids(self) -> list:
        return list(self._tracks.keys())

    def reset(self) -> None:
        self._tracks.clear()

    # ── internals ─────────────────────────────────────────────────────────
    def _advance(
        self, rec: _TrackRecord, inside: bool, now_ms: float, frame_index: int
    ) -> Decision:
        cfg = self.config

        if inside:
            rec.inside_frames += 1
            rec.outside_frames = 0

            if rec.state in (TrackState.OUTSIDE, TrackState.EXITED):
                rec.state = TrackState.ENTERING
                rec.first_inside_ms = now_ms

            if rec.state == TrackState.ENTERING:
                frames_ok = rec.inside_frames >= max(1, cfg.min_inside_frames)
                base_ms = rec.first_inside_ms if rec.first_inside_ms is not None else now_ms
                dwell_ok = (now_ms - base_ms) >= max(0, cfg.intrusion_dwell_ms)
                if frames_ok and dwell_ok:
                    rec.state = TrackState.INSIDE
                    rec.confirmed_frame = frame_index
                    if rec.armed and self._cooldown_ok(rec, now_ms):
                        rec.last_event_ms = now_ms
                        rec.armed = False
                        rec.total_events += 1
                        return self._decision(rec, emit=True, now_ms=now_ms)
        else:
            rec.outside_frames += 1
            rec.inside_frames = 0
            if rec.state in (TrackState.INSIDE, TrackState.ENTERING):
                if rec.outside_frames >= max(1, cfg.roi_exit_frames):
                    rec.state = TrackState.EXITED
                    rec.armed = True  # ready to fire again on the next entry
                    rec.first_inside_ms = None

        return self._decision(rec, emit=False, now_ms=now_ms)

    def _cooldown_ok(self, rec: _TrackRecord, now_ms: float) -> bool:
        if rec.last_event_ms is None:
            return True
        return (now_ms - rec.last_event_ms) >= max(0, self.config.event_cooldown_ms)

    @staticmethod
    def _decision(rec: _TrackRecord, emit: bool, now_ms: float) -> Decision:
        inside_ms = 0.0
        if rec.first_inside_ms is not None:
            inside_ms = max(0.0, now_ms - rec.first_inside_ms)
        return Decision(
            emit=emit,
            state=rec.state,
            inside_frames=rec.inside_frames,
            inside_ms=inside_ms,
        )

    def _prune(self, frame_index: int) -> None:
        limit = max(1, self.config.track_lost_frames)
        stale = [
            tid
            for tid, rec in self._tracks.items()
            if frame_index - rec.last_seen_frame > limit
        ]
        for tid in stale:
            self._tracks.pop(tid, None)
