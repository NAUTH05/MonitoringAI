"""Unit tests for the multi-camera runtime (config parsing + reconciliation).

The CameraWorker is replaced by a fake, so no models / cameras are needed.
"""
from __future__ import annotations

import logging
from types import SimpleNamespace

import pytest

from app.core import stream_manager as sm
from app.core.camera_config import (
    CameraRuntimeConfig,
    ModuleConfig,
    from_legacy_env,
    parse_runtime_config,
)

ROI_A = [{"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.1}, {"x": 0.9, "y": 0.9}]
ROI_B = [{"x": 0.2, "y": 0.2}, {"x": 0.8, "y": 0.2}, {"x": 0.8, "y": 0.8}]


class FakeWorker:
    instances: list["FakeWorker"] = []

    def __init__(self, settings, runtime, registry, storage, db, logger, roi_provider=None):  # noqa: ARG002
        self.runtime = runtime
        self.camera_id = runtime.camera_id
        self.identity = runtime.identity()
        self.roi_provider = roi_provider
        self.started = False
        self.stopped = False
        FakeWorker.instances.append(self)

    def start(self):
        self.started = True

    def stop(self):
        self.stopped = True

    def update_runtime(self, runtime):
        self.runtime = runtime
        self.identity = runtime.identity()


def _settings(**over):
    base = dict(runtime_config_enabled=True, runtime_config_poll_seconds=10.0)
    base.update(over)
    return SimpleNamespace(**base)


def _mgr(monkeypatch, settings=None) -> sm.StreamManager:
    FakeWorker.instances.clear()
    monkeypatch.setattr(sm, "CameraWorker", FakeWorker)
    return sm.StreamManager(settings or _settings(), logging.getLogger("t"))


def _cfg(cid="c1", name="Cam", url="rtsp://x", roi=None, enabled=True, task="INTRUSION"):
    return CameraRuntimeConfig(
        camera_id=cid, name=name, stream_name="s1", ai_source_url=url, enabled=enabled,
        modules=[ModuleConfig(code=task, enabled=True, config={"roiPolygon": roi} if roi else {})],
    )


# ── config parsing / derivation ───────────────────────────────────────────
def test_parse_runtime_config():
    payload = {
        "data": [{
            "cameraId": "c1", "name": "N", "streamName": "s",
            "aiSourceUrl": "rtsp://x", "enabled": True,
            "modules": [{"code": "INTRUSION", "enabled": True, "config": {"roiPolygon": ROI_A}}],
        }]
    }
    out = parse_runtime_config(payload)
    assert len(out) == 1
    assert out[0].camera_id == "c1"
    assert out[0].task_name == "intrusion"
    assert out[0].roi_polygon() == ROI_A


def test_parse_ignores_entries_without_camera_id():
    assert parse_runtime_config({"data": [{"name": "no id"}]}) == []
    assert parse_runtime_config("garbage") == []


def test_task_name_prefers_intrusion_over_plate():
    cfg = CameraRuntimeConfig(
        camera_id="c", name="n",
        modules=[ModuleConfig("VEHICLE", True, {}), ModuleConfig("INTRUSION", True, {})],
    )
    assert cfg.task_name == "intrusion"


def test_disabled_intrusion_module_is_not_chosen():
    cfg = CameraRuntimeConfig(
        camera_id="c", name="n",
        modules=[ModuleConfig("INTRUSION", False, {}), ModuleConfig("VEHICLE", True, {})],
    )
    assert cfg.task_name == "license_plate"
    assert cfg.roi_polygon() is None


def test_identity_excludes_roi_but_includes_source():
    # ROI must NOT be part of the restart fingerprint (it is applied live).
    assert _cfg(roi=ROI_A).identity() == _cfg(roi=ROI_B).identity()
    # A source change MUST be.
    assert _cfg(url="rtsp://a").identity() != _cfg(url="rtsp://b").identity()


def test_from_legacy_env():
    settings = SimpleNamespace(
        task_name="intrusion", monitoring_camera_id="cam", stream_id="st",
        camera_url="rtsp://127.0.0.1:8554/live", source_type="go2rtc", webcam_device=0,
    )
    cfg = from_legacy_env(settings)
    assert cfg.camera_id == "cam"
    assert cfg.task_name == "intrusion"
    assert cfg.ai_source_url == "rtsp://127.0.0.1:8554/live"


# ── reconciliation ────────────────────────────────────────────────────────
def test_adds_worker_for_new_camera(monkeypatch):
    mgr = _mgr(monkeypatch)
    mgr._reconcile([_cfg()])
    assert list(mgr.workers.keys()) == ["c1"]
    assert FakeWorker.instances[0].started


def test_noop_when_config_unchanged(monkeypatch):
    mgr = _mgr(monkeypatch)
    mgr._reconcile([_cfg(roi=ROI_A)])
    first = FakeWorker.instances[0]
    mgr._reconcile([_cfg(roi=ROI_A)])
    assert len(FakeWorker.instances) == 1        # no restart
    assert not first.stopped


def test_roi_change_updates_live_without_restart(monkeypatch):
    mgr = _mgr(monkeypatch)
    mgr._reconcile([_cfg(roi=ROI_A)])
    mgr._reconcile([_cfg(roi=ROI_B)])
    assert len(FakeWorker.instances) == 1        # same worker, no restart
    assert not FakeWorker.instances[0].stopped
    assert FakeWorker.instances[0].runtime.roi_polygon() == ROI_B


def test_source_change_restarts_worker(monkeypatch):
    mgr = _mgr(monkeypatch)
    mgr._reconcile([_cfg(url="rtsp://a")])
    mgr._reconcile([_cfg(url="rtsp://b")])
    assert len(FakeWorker.instances) == 2
    assert FakeWorker.instances[0].stopped


def test_disabled_camera_stops_worker(monkeypatch):
    mgr = _mgr(monkeypatch)
    mgr._reconcile([_cfg()])
    mgr._reconcile([_cfg(enabled=False)])
    assert mgr.workers == {}
    assert FakeWorker.instances[0].stopped


def test_removed_camera_stops_worker(monkeypatch):
    mgr = _mgr(monkeypatch)
    mgr._reconcile([_cfg(cid="a"), _cfg(cid="b")])
    mgr._reconcile([_cfg(cid="a")])
    assert list(mgr.workers.keys()) == ["a"]


def test_multiple_cameras_isolated(monkeypatch):
    mgr = _mgr(monkeypatch)
    mgr._reconcile([_cfg(cid="a"), _cfg(cid="b")])
    assert set(mgr.workers.keys()) == {"a", "b"}
    assert len(FakeWorker.instances) == 2


def test_legacy_mode_uses_env_config(monkeypatch):
    settings = SimpleNamespace(
        runtime_config_enabled=False, runtime_config_poll_seconds=10.0,
        task_name="intrusion", monitoring_camera_id="cam", stream_id="st",
        camera_url="rtsp://x", source_type="go2rtc", webcam_device=0,
    )
    mgr = _mgr(monkeypatch, settings)
    assert mgr.mode == "legacy-env"
    configs = mgr._fetch_configs()
    assert configs is not None and len(configs) == 1
    assert configs[0].camera_id == "cam"
