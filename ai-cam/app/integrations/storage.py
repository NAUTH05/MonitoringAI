"""Evidence image storage.

``AI_CAM_STORAGE_MODE=local`` (default) writes JPEGs under
``AI_CAM_STORAGE_DIR`` and returns a relative object key of the form
``{stream_id}/{YYYY-MM-DD}/{event_id}.jpg``. That is the same key shape the
production MinIO bucket uses, so MonitoringAI's ``/api/aicam-media/<key>``
endpoint can serve it without any code change.
"""
from __future__ import annotations

import logging
import os
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
    @abstractmethod
    def save(self, rel_path: str, image_bgr: np.ndarray) -> str:
        """Persist an image and return its relative object key."""

    @abstractmethod
    def describe(self) -> dict:
        ...


class LocalStorage(StorageBackend):
    def __init__(self, root: Path, logger: logging.Logger, quality: int = 90) -> None:
        self.root = Path(root)
        self.logger = logger
        self.quality = quality
        self.root.mkdir(parents=True, exist_ok=True)

    def save(self, rel_path: str, image_bgr: np.ndarray) -> str:
        rel_path = rel_path.replace("\\", "/")
        full = self.root / rel_path
        full.parent.mkdir(parents=True, exist_ok=True)
        data = encode_jpeg(image_bgr, self.quality)
        with open(full, "wb") as fh:
            fh.write(data)
        return rel_path

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

    def save(self, rel_path: str, image_bgr: np.ndarray) -> str:
        data = encode_jpeg(image_bgr, self.quality)
        self.client.put_object(
            self.bucket, rel_path, BytesIO(data), length=len(data), content_type="image/jpeg"
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
