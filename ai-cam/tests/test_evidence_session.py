"""Unit tests for the intrusion evidence session (no GPU / no ffmpeg needed).

The recorder and the MonitoringAI bridge are replaced by fakes so the session
lifecycle — one event per episode, snapshot cadence, post-roll, max duration,
isolation between cameras — is verified deterministically.
"""
from __future__ import annotations

import logging
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from app.services import evidence_session as es

FRAME = np.zeros((16, 16, 3), dtype=np.uint8)


class FakeStorage:
    def __init__(self) -> None:
        self.images: list[str] = []
        self.files: list[str] = []

    def save_image(self, rel_path, image_bgr):  # noqa: ARG002
        self.images.append(rel_path)
        return rel_path

    def save_file(self, rel_path, local_path, content_type=None):  # noqa: ARG002
        self.files.append(rel_path)
        return rel_path

    def describe(self):
        return {"mode": "fake"}


class FakeRecorder:
    instances: list["FakeRecorder"] = []

    def __init__(self, source_url, out_path, max_seconds, logger, ffmpeg_bin="ffmpeg"):  # noqa: ARG002
        self.source_url = source_url
        self.out_path = Path(out_path)
        self.max_seconds = max_seconds
        self.started = False
        self._running = False
        FakeRecorder.instances.append(self)

    def start(self):
        self.started = True
        self._running = True
        self.out_path.parent.mkdir(parents=True, exist_ok=True)
        self.out_path.write_bytes(b"fake-mp4")
        return True

    def is_running(self):
        return self._running

    def stop(self, timeout=10.0):  # noqa: ARG002
        self._running = False
        return self.out_path if self.out_path.exists() else None


@pytest.fixture
def posted(monkeypatch):
    FakeRecorder.instances.clear()
    monkeypatch.setattr(es, "VideoRecorder", FakeRecorder)
    calls: list[dict] = []
    monkeypatch.setattr(
        es.monitoring_api, "post_evidence",
        lambda *a, **k: (calls.append(k), True)[1],
    )
    monkeypatch.setattr(
        es.monitoring_api, "media_url",
        lambda settings, key: f"http://media/{key}",  # noqa: ARG005
    )
    return calls


def _settings(**over):
    base = dict(
        record_enabled=True,
        record_source="rtsp://127.0.0.1:8554/cam",
        record_max_seconds=120,
        record_postroll_seconds=5,
        evidence_interval_seconds=3,
        ffmpeg_bin="ffmpeg",
        source_type="go2rtc",
        camera_url="rtsp://127.0.0.1:8554/cam",
    )
    base.update(over)
    return SimpleNamespace(**base)


def _session(settings, storage, *, event_id="evt-1", ai_event_id="ai-1"):
    return es.EvidenceSession(
        settings, storage, logging.getLogger("t"),
        event_id=event_id, ai_event_id=ai_event_id, stream_id="cam",
    )


def _names(paths):
    return [p.split("/")[-1] for p in paths]


# ── recording ─────────────────────────────────────────────────────────────
def test_recording_starts_on_intrusion_and_attaches_to_same_event(posted):
    storage = FakeStorage()
    session = _session(_settings(), storage)
    session.start(FRAME, now=0.0)

    assert FakeRecorder.instances and FakeRecorder.instances[0].started
    assert FakeRecorder.instances[0].source_url == "rtsp://127.0.0.1:8554/cam"

    session.finish()
    assert session.finished
    assert storage.files and storage.files[0].endswith("evidence.mp4")
    videos = [c for c in posted if c.get("evidence_type") == "VIDEO"]
    assert len(videos) == 1
    assert videos[0]["event_id"] == "evt-1"           # SAME event, not a new one
    assert videos[0]["object_key"].endswith("evidence.mp4")


def test_max_duration_is_passed_to_the_recorder(posted):
    storage = FakeStorage()
    session = _session(_settings(record_max_seconds=120), storage)
    session.start(FRAME, now=0.0)
    assert FakeRecorder.instances[0].max_seconds == 120


def test_no_record_source_skips_video(posted):
    storage = FakeStorage()
    session = _session(
        _settings(record_source=None, camera_url=None, source_type="webcam"), storage
    )
    session.start(FRAME, now=0.0)
    assert FakeRecorder.instances == []
    session.finish()
    assert storage.files == []


def test_record_disabled_flag_skips_video(posted):
    storage = FakeStorage()
    session = _session(_settings(record_enabled=False), storage)
    session.start(FRAME, now=0.0)
    assert FakeRecorder.instances == []


# ── snapshots ─────────────────────────────────────────────────────────────
def test_first_snapshot_is_sequence_2_and_respects_interval(posted):
    storage = FakeStorage()
    session = _session(_settings(), storage)
    session.start(FRAME, now=0.0)                     # T0 = event image (seq 1)

    session.update(True, FRAME, now=1.0)              # < 3s -> nothing
    assert storage.images == []

    session.update(True, FRAME, now=3.0)              # >= 3s -> seq 2
    assert _names(storage.images) == ["image_0002.jpg"]
    assert posted[-1]["sequence"] == 2
    assert posted[-1]["event_id"] == "evt-1"


def test_snapshots_every_interval(posted):
    storage = FakeStorage()
    session = _session(_settings(), storage)
    session.start(FRAME, now=0.0)
    session.update(True, FRAME, now=3.0)
    session.update(True, FRAME, now=5.0)              # only 2s since last -> skip
    session.update(True, FRAME, now=6.0)
    assert _names(storage.images) == ["image_0002.jpg", "image_0003.jpg"]


def test_snapshots_stop_when_episode_ends(posted):
    storage = FakeStorage()
    session = _session(_settings(record_postroll_seconds=5), storage)
    session.start(FRAME, now=0.0)
    session.update(True, FRAME, now=3.0)              # one snapshot
    before = len(storage.images)

    session.update(False, FRAME, now=4.0)             # post-roll deadline = 9.0
    session.update(False, FRAME, now=9.0)             # -> finished
    assert session.finished

    session.update(False, FRAME, now=30.0)            # no snapshots after finish
    assert len(storage.images) == before


def test_postroll_keeps_recording_after_exit(posted):
    storage = FakeStorage()
    session = _session(_settings(record_postroll_seconds=5), storage)
    session.start(FRAME, now=0.0)
    recorder = FakeRecorder.instances[0]

    session.update(False, FRAME, now=1.0)             # exited -> post-roll
    assert recorder.is_running()                      # still recording during grace
    session.update(False, FRAME, now=5.9)
    assert recorder.is_running()
    session.update(False, FRAME, now=6.0)             # grace elapsed -> stop
    assert session.finished
    assert not recorder.is_running()


def test_reentry_within_postroll_keeps_the_same_session(posted):
    storage = FakeStorage()
    session = _session(_settings(record_postroll_seconds=5), storage)
    session.start(FRAME, now=0.0)
    session.update(False, FRAME, now=1.0)             # post-roll starts
    session.update(True, FRAME, now=3.0)              # re-entry cancels post-roll
    assert not session.finished
    session.update(False, FRAME, now=4.0)             # post-roll again (deadline 9)
    assert not session.finished
    session.update(False, FRAME, now=9.0)
    assert session.finished


# ── isolation ─────────────────────────────────────────────────────────────
def test_multiple_cameras_have_isolated_sessions(posted):
    storage_a, storage_b = FakeStorage(), FakeStorage()
    a = _session(_settings(), storage_a, event_id="evt-A", ai_event_id="camA")
    b = _session(_settings(), storage_b, event_id="evt-B", ai_event_id="camB")
    a.start(FRAME, now=0.0)
    b.start(FRAME, now=0.0)

    a.update(True, FRAME, now=3.0)
    b.update(True, FRAME, now=3.0)

    assert len(storage_a.images) == 1 and len(storage_b.images) == 1
    assert "camA" in storage_a.images[0]
    assert "camB" in storage_b.images[0]

    a.finish()
    assert a.finished and not b.finished          # finishing one does not touch the other
    assert [c["event_id"] for c in posted if c.get("evidence_type") == "VIDEO"] == ["evt-A"]
