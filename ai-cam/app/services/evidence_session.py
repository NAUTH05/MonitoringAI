"""Intrusion evidence session.

One intrusion *episode* is ONE Event. Instead of a single snapshot at the event
moment, the session accumulates evidence over the episode:

    T0            -> Event created + first annotated snapshot (event.imageUrl)
                     + video recording started
    while active  -> one annotated snapshot every INTRUSION_EVIDENCE_INTERVAL_SECONDS
    last exit     -> keep recording for INTRUSION_RECORD_POSTROLL_SECONDS
    end           -> stop recording, attach the video to the SAME Event

The recording is a straight ``ffmpeg -c copy`` of the source stream (the go2rtc
RTSP re-stream), so it keeps the REAL source FPS and quality and never rebuilds
video from the 5 FPS inference frames. The physical camera is still opened only
by go2rtc (single producer) — FFmpeg reads the re-stream, not the device.

All timing comes from :class:`~app.config.Settings`; nothing is hard-coded.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np

from ..integrations import monitoring_api
from ..integrations.storage import StorageBackend


class VideoRecorder:
    """Record ``source_url`` to an MP4 with FFmpeg (stream copy, no re-encode)."""

    def __init__(
        self,
        source_url: str,
        out_path: Path,
        max_seconds: float,
        logger: logging.Logger,
        ffmpeg_bin: str = "ffmpeg",
    ) -> None:
        self.source_url = source_url
        self.out_path = Path(out_path)
        self.max_seconds = max(1.0, float(max_seconds))
        self.logger = logger
        self.ffmpeg_bin = ffmpeg_bin
        self._proc: Optional[subprocess.Popen] = None
        self.started_at: Optional[float] = None

    @staticmethod
    def available(ffmpeg_bin: str = "ffmpeg") -> bool:
        return shutil.which(ffmpeg_bin) is not None

    def start(self) -> bool:
        if not self.source_url:
            return False
        if not self.available(self.ffmpeg_bin):
            self.logger.warning(
                "ffmpeg not found (%s); evidence video disabled", self.ffmpeg_bin
            )
            return False
        self.out_path.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            self.ffmpeg_bin, "-hide_banner", "-loglevel", "warning",
            "-rtsp_transport", "tcp",
            "-i", self.source_url,
            "-t", str(int(self.max_seconds)),
            "-c", "copy",
            "-movflags", "+faststart",
            "-y", str(self.out_path),
        ]
        try:
            self._proc = subprocess.Popen(
                cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
        except Exception as exc:  # pragma: no cover - environment dependent
            self.logger.warning("Failed to start evidence recorder: %s", exc)
            self._proc = None
            return False
        self.started_at = time.time()
        self.logger.info(
            "Evidence recording started (max %ss) -> %s",
            int(self.max_seconds), self.out_path.name,
        )
        return True

    def is_running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def stop(self, timeout: float = 10.0) -> Optional[Path]:
        """Stop the recorder and return the finished file (or None)."""
        proc = self._proc
        self._proc = None
        if proc is not None and proc.poll() is None:
            try:
                proc.terminate()
                try:
                    proc.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)
            except Exception:  # pragma: no cover
                pass
        if self.out_path.exists() and self.out_path.stat().st_size > 0:
            return self.out_path
        return None


class EvidenceSession:
    """Accumulates snapshots + one video onto a single MonitoringAI Event."""

    def __init__(
        self,
        settings,
        storage: StorageBackend,
        logger: logging.Logger,
        *,
        event_id: Optional[str],
        ai_event_id: str,
        stream_id: str,
        record_source: Optional[str] = None,
    ) -> None:
        self.settings = settings
        self.storage = storage
        self.logger = logger
        self.event_id = event_id                 # MonitoringAI event id
        self.ai_event_id = ai_event_id           # AI-Cam id (storage path)
        self.stream_id = stream_id

        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        self._dir = f"{stream_id}/{date_str}/{ai_event_id}"

        # Sequence 1 is the first image, already created by the backend from the
        # event's imageUrl. Extra snapshots start at 2.
        self._seq = 1
        self._started_at = time.time()
        self._last_active_at = self._started_at
        self._last_snapshot_at = self._started_at
        self._postroll_deadline: Optional[float] = None
        self.finished = False

        self._recorder: Optional[VideoRecorder] = None
        self._recording = False
        self._video_finalized = False
        self._record_source = record_source or settings.record_source or settings.camera_url

    # ── lifecycle ─────────────────────────────────────────────────────────
    def start(self, annotated: Optional[np.ndarray], now: Optional[float] = None) -> None:
        """T0: the first snapshot is already the event image; start recording."""
        now = time.time() if now is None else now
        self._last_snapshot_at = now
        self._start_recording()

    def update(
        self, active: bool, annotated: Optional[np.ndarray], now: Optional[float] = None
    ) -> None:
        """Advance the session by one processed frame."""
        if self.finished:
            return
        now = time.time() if now is None else now

        if active:
            self._last_active_at = now
            self._postroll_deadline = None
        else:
            if self._postroll_deadline is None:
                self._postroll_deadline = now + max(0.0, self.settings.record_postroll_seconds)
            elif now >= self._postroll_deadline:
                self.finish()
                return

        if (
            annotated is not None
            and (now - self._last_snapshot_at) >= max(0.1, self.settings.evidence_interval_seconds)
        ):
            self._snapshot(annotated, now)

        # The recorder self-terminates at the max duration (-t). When it stops
        # on its own, finalize the video without waiting for the episode to end.
        if self._recording and self._recorder is not None and not self._recorder.is_running():
            self._finalize_video()

    def finish(self) -> None:
        """Stop recording and attach the video to the same Event."""
        if self.finished:
            return
        if self._recorder is not None and not self._video_finalized:
            self._finalize_video()
        self.finished = True

    def describe(self) -> dict:
        return {
            "event_id": self.event_id,
            "ai_event_id": self.ai_event_id,
            "snapshots": self._seq,
            "recording": self._recording,
            "duration_s": round(time.time() - self._started_at, 1),
            "finished": self.finished,
        }

    # ── internals ─────────────────────────────────────────────────────────
    def _start_recording(self) -> None:
        if not self.settings.record_enabled:
            self.logger.info("Evidence recording disabled (INTRUSION_RECORD_ENABLED=false)")
            return
        if not self._record_source:
            self.logger.info(
                "No record source (CAMERA_SOURCE_TYPE=%s); video evidence disabled",
                self.settings.source_type,
            )
            return
        tmp = Path(tempfile.gettempdir()) / f"intrusion_{self.ai_event_id}.mp4"
        self._recorder = VideoRecorder(
            self._record_source, tmp, self.settings.record_max_seconds,
            self.logger, self.settings.ffmpeg_bin,
        )
        self._recording = self._recorder.start()

    def _snapshot(self, annotated: np.ndarray, now: float) -> None:
        self._seq += 1
        self._last_snapshot_at = now
        key = f"{self._dir}/image_{self._seq:04d}.jpg"
        try:
            self.storage.save_image(key, annotated)
        except Exception as exc:
            self.logger.warning("Evidence snapshot save failed: %s", exc)
            return
        monitoring_api.post_evidence(
            self.settings, self.logger,
            event_id=self.event_id,
            evidence_type="IMAGE",
            url=monitoring_api.media_url(self.settings, key),
            object_key=key,
            sequence=self._seq,
            captured_at=datetime.now(timezone.utc),
        )

    def _finalize_video(self) -> None:
        if self._video_finalized:
            return
        self._video_finalized = True
        path = self._recorder.stop() if self._recorder is not None else None
        self._recording = False
        if path is None:
            return
        duration_ms = int(max(0.0, time.time() - self._started_at) * 1000)
        key = f"{self._dir}/evidence.mp4"
        try:
            self.storage.save_file(key, path, content_type="video/mp4")
        except Exception as exc:
            self.logger.warning("Evidence video save failed: %s", exc)
            return
        monitoring_api.post_evidence(
            self.settings, self.logger,
            event_id=self.event_id,
            evidence_type="VIDEO",
            url=monitoring_api.media_url(self.settings, key),
            object_key=key,
            duration_ms=duration_ms,
            metadata={"durationMs": duration_ms},
        )
        try:
            path.unlink()
        except Exception:
            pass
