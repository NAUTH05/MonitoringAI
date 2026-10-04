"""Storage backend tests: local image/bytes/file + MinIO interface.

LocalStorage is exercised for real (temp dir). MinIO is exercised against a fake
`minio` module injected into ``sys.modules`` so the interface (put_object /
fput_object with the right content types) is verified without a MinIO server.
"""
from __future__ import annotations

import logging
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from app.integrations.storage import LocalStorage, MinioStorage, create_storage, encode_jpeg

FRAME = np.zeros((8, 8, 3), dtype=np.uint8)


# ── local ─────────────────────────────────────────────────────────────────
def test_local_save_image_returns_key_and_writes_file(tmp_path):
    storage = LocalStorage(tmp_path, logging.getLogger("t"))
    key = storage.save_image("cam/2026-01-01/evt/image_0001.jpg", FRAME)
    assert key == "cam/2026-01-01/evt/image_0001.jpg"
    assert (tmp_path / "cam/2026-01-01/evt/image_0001.jpg").exists()


def test_local_save_bytes(tmp_path):
    storage = LocalStorage(tmp_path, logging.getLogger("t"))
    key = storage.save_bytes("cam/d/evt/evidence.mp4", b"mp4-bytes", content_type="video/mp4")
    assert key == "cam/d/evt/evidence.mp4"
    assert (tmp_path / "cam/d/evt/evidence.mp4").read_bytes() == b"mp4-bytes"


def test_local_save_file_copies(tmp_path):
    storage = LocalStorage(tmp_path, logging.getLogger("t"))
    src = tmp_path / "source.mp4"
    src.write_bytes(b"recorded-video")
    key = storage.save_file("cam/d/evt/evidence.mp4", src, content_type="video/mp4")
    assert (tmp_path / "cam/d/evt/evidence.mp4").read_bytes() == b"recorded-video"
    assert src.exists()  # copy, not move
    assert key == "cam/d/evt/evidence.mp4"


def test_local_save_alias_still_works(tmp_path):
    # The license-plate pipeline still calls .save()
    storage = LocalStorage(tmp_path, logging.getLogger("t"))
    storage.save("lp/d/evt.jpg", FRAME)
    assert (tmp_path / "lp/d/evt.jpg").exists()


def test_local_backslash_key_is_normalised(tmp_path):
    storage = LocalStorage(tmp_path, logging.getLogger("t"))
    key = storage.save_bytes("cam\\d\\evt\\x.mp4", b"x")
    assert key == "cam/d/evt/x.mp4"
    assert (tmp_path / "cam/d/evt/x.mp4").exists()


def test_encode_jpeg_produces_jpeg_magic():
    data = encode_jpeg(FRAME, 80)
    assert data[:2] == b"\xff\xd8"  # JPEG SOI


# ── minio interface ───────────────────────────────────────────────────────
class _FakeMinio:
    instances: list["_FakeMinio"] = []

    def __init__(self, endpoint, access_key=None, secret_key=None, secure=False):  # noqa: ARG002
        self.endpoint = endpoint
        self.objects: dict[str, tuple[bytes, str | None]] = {}
        self.buckets: list[str] = []
        _FakeMinio.instances.append(self)

    def bucket_exists(self, bucket):
        return bucket in self.buckets

    def make_bucket(self, bucket):
        self.buckets.append(bucket)

    def put_object(self, bucket, name, data, length=None, content_type=None):  # noqa: ARG002
        self.objects[name] = (data.read(), content_type)

    def fput_object(self, bucket, name, path, content_type=None):  # noqa: ARG002
        with open(path, "rb") as fh:
            self.objects[name] = (fh.read(), content_type)


@pytest.fixture
def minio_storage(monkeypatch):
    module = types.ModuleType("minio")
    module.Minio = _FakeMinio  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "minio", module)
    _FakeMinio.instances.clear()

    settings = SimpleNamespace(
        minio_endpoint="localhost:9000",
        minio_access_key="k",
        minio_secret_key="s",
        minio_bucket="events",
        minio_secure=False,
    )
    storage = MinioStorage(settings, logging.getLogger("t"))
    return storage, _FakeMinio.instances[0]


def test_minio_creates_bucket_when_missing(minio_storage):
    _storage, client = minio_storage
    assert client.buckets == ["events"]


def test_minio_save_image_uses_jpeg_content_type(minio_storage):
    storage, client = minio_storage
    key = storage.save_image("cam/d/evt/image_0001.jpg", FRAME)
    assert key == "cam/d/evt/image_0001.jpg"
    body, content_type = client.objects[key]
    assert content_type == "image/jpeg"
    assert body[:2] == b"\xff\xd8"


def test_minio_save_bytes_uses_given_content_type(minio_storage):
    storage, client = minio_storage
    storage.save_bytes("cam/d/evt/evidence.mp4", b"v", content_type="video/mp4")
    assert client.objects["cam/d/evt/evidence.mp4"] == (b"v", "video/mp4")


def test_minio_save_file_uses_fput(minio_storage, tmp_path):
    storage, client = minio_storage
    src = tmp_path / "rec.mp4"
    src.write_bytes(b"recording")
    storage.save_file("cam/d/evt/evidence.mp4", src, content_type="video/mp4")
    assert client.objects["cam/d/evt/evidence.mp4"] == (b"recording", "video/mp4")


def test_minio_describe(minio_storage):
    storage, _client = minio_storage
    assert storage.describe() == {"mode": "minio", "bucket": "events"}


# ── factory ───────────────────────────────────────────────────────────────
def test_create_storage_defaults_to_local(tmp_path):
    settings = SimpleNamespace(storage_mode="local", storage_dir=tmp_path)
    storage = create_storage(settings, logging.getLogger("t"))
    assert isinstance(storage, LocalStorage)
    assert storage.describe()["mode"] == "local"
