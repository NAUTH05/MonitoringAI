"""Central runtime configuration for the local AI-Cam service.

All values are read from environment variables, optionally loaded from
``ai-cam/.env``. Model paths default to the pre-trained artifacts that already
sit in the ``ai-cam/`` directory and are never modified by this app.

Every threshold used by the pipeline is configurable here so it can be tuned
without editing code (and is documented in ``ai-cam/README.md``).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

AI_CAM_DIR = Path(__file__).resolve().parent.parent
DEFAULT_ENV_FILE = AI_CAM_DIR / ".env"

DEFAULT_AICAM_DSN = "postgresql://monitoring:monitoring_pass@localhost:5432/aicam"


def load_dotenv(path: Path = DEFAULT_ENV_FILE) -> None:
    """Minimal ``.env`` loader (avoids a python-dotenv dependency).

    Existing process environment variables always win over the file.
    """
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def _env_int(name: str, default: int) -> int:
    raw = _env(name)
    if raw is None:
        return default
    try:
        return int(float(raw))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = _env(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = _env(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on", "y")


def _env_path(name: str, default: str) -> Path:
    return _resolve(_env(name, default) or default)


def _resolve(path_str: str) -> Path:
    p = Path(path_str).expanduser()
    return p if p.is_absolute() else (AI_CAM_DIR / p)


@dataclass
class Settings:
    # ── Source / camera ───────────────────────────────────────────────────
    source_type: str
    webcam_device: int
    webcam_backend: str
    webcam_width: int
    webcam_height: int
    webcam_fps: int
    camera_url: Optional[str]
    rtsp_transport: str
    reconnect_delay: float

    # ── Identity / cadence ────────────────────────────────────────────────
    stream_id: str
    task_name: str
    processing_fps: float

    # ── Models ────────────────────────────────────────────────────────────
    vehicle_model_path: Path
    plate_model_path: Path
    vehicle_engine_path: Path
    plate_engine_path: Path
    person_model_path: Path
    person_engine_path: Path
    trocr_model_dir: Path
    prefer_tensorrt: bool
    device: str  # auto | cuda | cpu
    use_fp16: bool

    # ── License-plate thresholds ──────────────────────────────────────────
    vehicle_conf: float
    plate_conf: float
    min_plate_length: int
    max_plate_length: int
    track_stale_frames: int
    plate_crop_padding: int
    min_plate_crop_w: int
    min_plate_crop_h: int
    min_plate_aspect: float
    max_plate_aspect: float

    # ── Intrusion (person + ROI) ──────────────────────────────────────────
    person_conf: float
    min_inside_frames: int
    intrusion_dwell_ms: int
    event_cooldown_ms: int
    roi_exit_frames: int
    track_lost_frames: int

    # ── ROI configuration source ──────────────────────────────────────────
    roi_source: str  # config | static
    roi_file: Optional[Path]
    roi_polygon_inline: Optional[str]
    roi_poll_seconds: float

    # ── Storage ───────────────────────────────────────────────────────────
    storage_mode: str  # local | minio
    storage_dir: Path
    minio_endpoint: Optional[str]
    minio_access_key: Optional[str]
    minio_secret_key: Optional[str]
    minio_bucket: str
    minio_secure: bool

    # ── Database ──────────────────────────────────────────────────────────
    aicam_database_url: str
    db_enabled: bool

    # ── MonitoringAI push (optional) ──────────────────────────────────────
    monitoring_api_url: Optional[str]
    monitoring_api_key: Optional[str]
    monitoring_camera_id: Optional[str]
    monitoring_media_base_url: Optional[str]

    # ── Diagnostics / status server ───────────────────────────────────────
    status_enabled: bool
    status_host: str
    status_port: int
    preview_jpeg_quality: int
    log_level: str

    @classmethod
    def from_env(cls) -> "Settings":
        source_type = (_env("CAMERA_SOURCE_TYPE", "webcam") or "webcam").strip().lower()
        device = (_env("AI_DEVICE", "auto") or "auto").strip().lower()
        return cls(
            source_type=source_type,
            webcam_device=_env_int("WEBCAM_DEVICE", 0),
            webcam_backend=(_env("WEBCAM_BACKEND", "dshow") or "dshow").strip().lower(),
            webcam_width=_env_int("WEBCAM_WIDTH", 1280),
            webcam_height=_env_int("WEBCAM_HEIGHT", 720),
            webcam_fps=_env_int("WEBCAM_FPS", 30),
            camera_url=_env("CAMERA_URL"),
            rtsp_transport=(_env("RTSP_TRANSPORT", "tcp") or "tcp").strip().lower(),
            reconnect_delay=_env_float("CAMERA_RECONNECT_DELAY", 2.0),
            stream_id=(_env("STREAM_ID", "laptop_webcam") or "laptop_webcam").strip(),
            task_name=(_env("AI_TASK_NAME", "license_plate") or "license_plate").strip(),
            processing_fps=_env_float("AI_PROCESSING_FPS", 5.0),
            vehicle_model_path=_env_path("VEHICLE_MODEL_PATH", "vehicle_model.pt"),
            plate_model_path=_env_path("PLATE_MODEL_PATH", "plate_model.pt"),
            vehicle_engine_path=_env_path("VEHICLE_ENGINE_PATH", "vehicle_model.engine"),
            plate_engine_path=_env_path("PLATE_ENGINE_PATH", "plate_model.engine"),
            person_model_path=_env_path("PERSON_MODEL_PATH", "models/intrusion/person_model.pt"),
            person_engine_path=_env_path("PERSON_ENGINE_PATH", "models/intrusion/person_model.engine"),
            trocr_model_dir=_env_path("TROCR_MODEL_DIR", "trocr_vn_plate_final"),
            prefer_tensorrt=_env_bool("AI_PREFER_TENSORRT", True),
            device=device,
            use_fp16=_env_bool("AI_USE_FP16", True),
            vehicle_conf=_env_float("VEHICLE_CONF_THRESH", 0.5),
            plate_conf=_env_float("PLATE_CONF_THRESH", 0.4),
            min_plate_length=_env_int("MIN_PLATE_LENGTH", 6),
            max_plate_length=_env_int("MAX_PLATE_LENGTH", 9),
            track_stale_frames=_env_int("TRACK_STALE_FRAMES", 30),
            plate_crop_padding=_env_int("PLATE_CROP_PADDING", 2),
            min_plate_crop_w=_env_int("MIN_PLATE_CROP_W", 16),
            min_plate_crop_h=_env_int("MIN_PLATE_CROP_H", 8),
            min_plate_aspect=_env_float("MIN_PLATE_ASPECT", 0.15),
            max_plate_aspect=_env_float("MAX_PLATE_ASPECT", 8.0),
            person_conf=_env_float("PERSON_CONF_THRESH", 0.35),
            min_inside_frames=_env_int("INTRUSION_MIN_INSIDE_FRAMES", 3),
            intrusion_dwell_ms=_env_int("INTRUSION_DWELL_MS", 1000),
            event_cooldown_ms=_env_int("INTRUSION_EVENT_COOLDOWN_MS", 5000),
            roi_exit_frames=_env_int("INTRUSION_ROI_EXIT_FRAMES", 5),
            track_lost_frames=_env_int("INTRUSION_TRACK_LOST_FRAMES", 30),
            roi_source=(_env("AI_ROI_SOURCE", "config") or "config").strip().lower(),
            roi_file=_env_path("AI_ROI_FILE", "data/roi.json"),
            roi_polygon_inline=_env("AI_ROI_POLYGON"),
            roi_poll_seconds=_env_float("AI_ROI_POLL_SECONDS", 5.0),
            storage_mode=(_env("AI_CAM_STORAGE_MODE", "local") or "local").strip().lower(),
            storage_dir=_env_path("AI_CAM_STORAGE_DIR", "data/events"),
            minio_endpoint=_env("MINIO_ENDPOINT"),
            minio_access_key=_env("MINIO_ACCESS_KEY"),
            minio_secret_key=_env("MINIO_SECRET_KEY"),
            minio_bucket=_env("MINIO_BUCKET", "events") or "events",
            minio_secure=_env_bool("MINIO_SECURE", False),
            aicam_database_url=_env("AICAM_DATABASE_URL", DEFAULT_AICAM_DSN) or DEFAULT_AICAM_DSN,
            db_enabled=_env_bool("AI_CAM_DB_ENABLED", True),
            monitoring_api_url=_env("MONITORING_API_URL"),
            monitoring_api_key=_env("MONITORING_API_KEY"),
            monitoring_camera_id=_env("MONITORING_CAMERA_ID"),
            monitoring_media_base_url=_env("MONITORING_MEDIA_BASE_URL"),
            status_enabled=_env_bool("STATUS_SERVER_ENABLED", True),
            status_host=_env("STATUS_SERVER_HOST", "127.0.0.1") or "127.0.0.1",
            status_port=_env_int("STATUS_SERVER_PORT", 8090),
            preview_jpeg_quality=_env_int("PREVIEW_JPEG_QUALITY", 80),
            log_level=(_env("LOG_LEVEL", "INFO") or "INFO").strip().upper(),
        )
