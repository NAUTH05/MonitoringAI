"""Evidence storage (images AND recorded video).

The backend is abstract on purpose so the intrusion business logic never knows
whether bytes land on local disk or in MinIO:

    AI_CAM_STORAGE_MODE=local   -> files under AI_CAM_STORAGE_DIR   (default)
    AI_CAM_STORAGE_MODE=minio   -> objects in a MinIO bucket        (optional)

Object keys are portable and identical for both backends, e.g.::

    <stream_id>/<YYYY-MM-DD>/<event_id>/image_0001.jpg
    <stream_id>/<YYYY-MM-DD>/<event_id>/image_0002.jpg
    <stream_id>/<YYYY-MM-DD>/<event_id>/evidence.mp4

MonitoringAI's ``/api/aicam-media/<key>`` endpoint serves whatever key is stored,
so switching backend requires no change to the AI task or the dashboard.
"""
from __future__ import annotations

import logging
import shutil
from abc import ABC, abstractmethod
from io import BytesIO
from pathlib import Path

import cv2
import numpy as np

from ..config import Settings


def encode_jpeg(image_bgr: np.ndarray, quality: int = 90) -> bytes:
    ok, buf = cv2.imencode(".jpg", image_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
    if not ok:
        raise RuntimeError("JPEG encoding failed")
    return buf.tobytes()


class StorageBackend(ABC):
    """Stores evidence artifacts and returns their relative object key."""

    @abstractmethod
    def save_image(self, rel_path: str, image_bgr: np.ndarray) -> str:
        """Persist a BGR image (JPEG) and return its relative object key."""

    @abstractmethod
    def save_bytes(
        self, rel_path: str, data: bytes, content_type: str = "application/octet-stream"
    ) -> str:
        """Persist raw bytes (used for recorded video) and return the key."""

    @abstractmethod
    def save_file(
        self, rel_path: str, local_path: Path, content_type: str = "application/octet-stream"
    ) -> str:
        """Persist a file already on local disk and return its key."""

    @abstractmethod
    def describe(self) -> dict:
        ...

    # Backwards-compatible alias: the license-plate pipeline calls ``.save()``.
    def save(self, rel_path: str, image_bgr: np.ndarray) -> str:
        return self.save_image(rel_path, image_bgr)


class LocalStorage(StorageBackend):
    def __init__(self, root: Path, logger: logging.Logger, quality: int = 90) -> None:
        self.root = Path(root)
        self.logger = logger
        self.quality = quality
        self.root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, rel_path: str) -> Path:
        rel_path = rel_path.replace("\\", "/")
        full = self.root / rel_path
        full.parent.mkdir(parents=True, exist_ok=True)
        return full

    def save_image(self, rel_path: str, image_bgr: np.ndarray) -> str:
        data = encode_jpeg(image_bgr, self.quality)
        return self.save_bytes(rel_path, data, content_type="image/jpeg")

    def save_bytes(
        self, rel_path: str, data: bytes, content_type: str = "application/octet-stream"
    ) -> str:
        full = self._resolve(rel_path)
        with open(full, "wb") as fh:
            fh.write(data)
        return rel_path.replace("\\", "/")

    def save_file(
        self, rel_path: str, local_path: Path, content_type: str = "application/octet-stream"
    ) -> str:
        full = self._resolve(rel_path)
        shutil.copyfile(str(local_path), str(full))
        return rel_path.replace("\\", "/")

    def describe(self) -> dict:
        return {"mode": "local", "root": str(self.root)}


class MinioStorage(StorageBackend):
    def __init__(self, settings: Settings, logger: logging.Logger, quality: int = 90) -> None:
        try:
            from minio import Minio
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "AI_CAM_STORAGE_MODE=minio requires the 'minio' package "
                "(pip install minio)."
            ) from exc

        if not settings.minio_endpoint:
            raise RuntimeError("MINIO_ENDPOINT is required for minio storage mode")

        self.client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
        )
        self.bucket = settings.minio_bucket
        self.logger = logger
        self.quality = quality
        if not self.client.bucket_exists(self.bucket):
            self.client.make_bucket(self.bucket)

    def save_image(self, rel_path: str, image_bgr: np.ndarray) -> str:
        data = encode_jpeg(image_bgr, self.quality)
        return self.save_bytes(rel_path, data, content_type="image/jpeg")

    def save_bytes(
        self, rel_path: str, data: bytes, content_type: str = "application/octet-stream"
    ) -> str:
        self.client.put_object(
            self.bucket, rel_path, BytesIO(data), length=len(data), content_type=content_type
        )
        return rel_path

    def save_file(
        self, rel_path: str, local_path: Path, content_type: str = "application/octet-stream"
    ) -> str:
        self.client.fput_object(
            self.bucket, rel_path, str(local_path), content_type=content_type
        )
        return rel_path

    def describe(self) -> dict:
        return {"mode": "minio", "bucket": self.bucket}


def create_storage(settings: Settings, logger: logging.Logger) -> StorageBackend:
    if settings.storage_mode == "minio":
        logger.info("Using MinIO storage")
        return MinioStorage(settings, logger)
    logger.info("Using local storage at %s", settings.storage_dir)
    return LocalStorage(settings.storage_dir, logger)
