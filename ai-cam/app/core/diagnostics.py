"""Startup environment diagnostics.

Prints exactly what the runtime selected so GPU/model problems are obvious
before any inference happens.
"""
from __future__ import annotations

import logging
import platform
import sys
from importlib import metadata
from typing import Any, Dict


def _pkg_version(name: str) -> str:
    try:
        return metadata.version(name)
    except Exception:
        return "not installed"


def collect_environment() -> Dict[str, Any]:
    info: Dict[str, Any] = {
        "python_version": sys.version.split()[0],
        "platform": platform.platform(),
        "torch": _pkg_version("torch"),
        "torchvision": _pkg_version("torchvision"),
        "ultralytics": _pkg_version("ultralytics"),
        "transformers": _pkg_version("transformers"),
        "opencv": _pkg_version("opencv-python"),
        "numpy": _pkg_version("numpy"),
        "psycopg2": _pkg_version("psycopg2-binary"),
        "tensorrt": _pkg_version("tensorrt"),
    }
    try:
        import torch

        info["torch_cuda_version"] = torch.version.cuda or "cpu-build"
        info["cuda_available"] = bool(torch.cuda.is_available())
        if torch.cuda.is_available():
            info["gpu_name"] = torch.cuda.get_device_name(0)
            info["gpu_capability"] = ".".join(str(v) for v in torch.cuda.get_device_capability(0))
            props = torch.cuda.get_device_properties(0)
            info["gpu_vram_mb"] = round(props.total_memory / (1024 * 1024))
    except Exception as exc:  # pragma: no cover - defensive
        info["cuda_available"] = False
        info["cuda_error"] = str(exc)
    return info


def log_environment(logger: logging.Logger) -> Dict[str, Any]:
    info = collect_environment()
    logger.info("===== AI-Cam environment =====")
    for key, value in info.items():
        logger.info("  %-18s : %s", key, value)
    logger.info("==============================")
    return info
