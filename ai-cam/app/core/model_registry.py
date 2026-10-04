"""Loads every AI model ONCE and shares it with all tasks.

Selection order for the two YOLO detectors:
    1. a locally built TensorRT engine on this GPU (if present and loadable)
    2. the original ``.pt`` weights on CUDA
    3. the original ``.pt`` weights on CPU (diagnostic fallback)

The pre-trained files are only ever read, never rewritten. Class names are read
from the model itself (``model.names``) instead of being hard-coded, because
the vehicle mapping differs between the legacy script and the production task.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Optional, Tuple

from ..config import Settings


class ModelRegistry:
    def __init__(self, settings: Settings, logger: logging.Logger) -> None:
        self.settings = settings
        self.logger = logger
        self.device: str = "cpu"
        self.yolo_device: Any = "cpu"
        self.vehicle_model: Any = None
        self.plate_model: Any = None
        self.vehicle_source: Optional[str] = None
        self.plate_source: Optional[str] = None
        self.vehicle_names: dict = {}
        self.plate_names: dict = {}
        self.person_model: Any = None
        self.person_source: Optional[str] = None
        self.person_names: dict = {}
        self.trocr_processor: Any = None
        self.trocr_model: Any = None
        self.ocr_device: str = "cpu"
        self.ocr_loaded: bool = False
        self.warnings: list = []

    # ── public API ────────────────────────────────────────────────────────
    def load(self) -> None:
        self._pick_device()
        if self._is_person_task():
            # Intrusion only needs the person detector; skip the (heavy)
            # vehicle/plate YOLO + TrOCR stack to save VRAM on the 4 GB GPU.
            self.person_model, self.person_source = self._load_yolo(
                self.settings.person_engine_path,
                self.settings.person_model_path,
                "person",
                env_var="PERSON_MODEL_PATH",
            )
            self.person_names = self._read_names(self.person_model)
            self.logger.info("Person-only model set loaded (task=%s)", self.settings.task_name)
            return

        self.vehicle_model, self.vehicle_source = self._load_yolo(
            self.settings.vehicle_engine_path, self.settings.vehicle_model_path,
            "vehicle", env_var="VEHICLE_MODEL_PATH",
        )
        self.plate_model, self.plate_source = self._load_yolo(
            self.settings.plate_engine_path, self.settings.plate_model_path,
            "plate", env_var="PLATE_MODEL_PATH",
        )
        self.vehicle_names = self._read_names(self.vehicle_model)
        self.plate_names = self._read_names(self.plate_model)
        self._load_trocr()

    def _is_person_task(self) -> bool:
        return (self.settings.task_name or "").strip().lower() in (
            "intrusion", "restricted_zone", "person",
        )

    def yolo_predict_kwargs(self) -> dict:
        kwargs: dict = {"verbose": False, "device": self.yolo_device}
        if self.settings.use_fp16 and self.device == "cuda":
            # Newer ultralytics uses `quantize` (16 = FP16); `half` is deprecated.
            kwargs["quantize"] = 16
        return kwargs

    def describe(self) -> dict:
        return {
            "device": self.device,
            "yolo_device": self.yolo_device,
            "fp16": bool(self.settings.use_fp16 and self.device == "cuda"),
            "task": self.settings.task_name,
            "vehicle_model": self.vehicle_source,
            "vehicle_classes": self.vehicle_names,
            "plate_model": self.plate_source,
            "plate_classes": self.plate_names,
            "person_model": self.person_source,
            "person_classes": self.person_names,
            "ocr_device": self.ocr_device,
            "ocr_loaded": self.ocr_loaded,
            "warnings": self.warnings,
        }

    # ── device ────────────────────────────────────────────────────────────
    def _pick_device(self) -> None:
        try:
            import torch

            cuda_ok = bool(torch.cuda.is_available())
        except Exception:
            cuda_ok = False

        requested = self.settings.device
        if requested == "cpu":
            self.device = "cpu"
        elif requested == "cuda":
            self.device = "cuda" if cuda_ok else "cpu"
            if not cuda_ok:
                self.warnings.append("AI_DEVICE=cuda requested but CUDA is unavailable; using CPU")
        else:  # auto
            self.device = "cuda" if cuda_ok else "cpu"

        self.yolo_device = 0 if self.device == "cuda" else "cpu"
        self.logger.info("Selected compute device: %s", self.device)

    # ── YOLO ──────────────────────────────────────────────────────────────
    def _load_yolo(
        self, engine: Path, pt: Path, tag: str, env_var: str = "MODEL_PATH"
    ) -> Tuple[Any, Optional[str]]:
        from ultralytics import YOLO

        if self.settings.prefer_tensorrt and engine.exists():
            try:
                model = YOLO(str(engine), task="detect")
                self.logger.info("%s model loaded from TensorRT engine: %s", tag, engine.name)
                return model, str(engine)
            except Exception as exc:
                self.warnings.append(f"{tag}: failed to load {engine.name} ({exc}); falling back to .pt")
                self.logger.warning(
                    "%s TensorRT engine %s could not be loaded (%s); falling back to .pt",
                    tag, engine.name, exc,
                )

        if not pt.exists():
            raise FileNotFoundError(
                f"{tag} weights not found. Looked for engine={engine} and pt={pt}. "
                f"Pass the correct path via {env_var}."
            )

        model = YOLO(str(pt), task="detect")
        self.logger.info("%s model loaded from weights: %s", tag, pt.name)
        return model, str(pt)

    @staticmethod
    def _read_names(model: Any) -> dict:
        names = getattr(model, "names", None)
        if isinstance(names, dict):
            return {int(k): str(v) for k, v in names.items()}
        if isinstance(names, (list, tuple)):
            return {i: str(v) for i, v in enumerate(names)}
        return {}

    # ── TrOCR ─────────────────────────────────────────────────────────────
    def _load_trocr(self) -> None:
        import torch
        from transformers import TrOCRProcessor, VisionEncoderDecoderModel

        model_dir = self.settings.trocr_model_dir
        if not model_dir.exists():
            self.warnings.append(f"TrOCR model directory not found: {model_dir}")
            self.logger.warning("TrOCR model directory not found: %s", model_dir)
            return

        self.ocr_device = self.device
        self.trocr_processor = TrOCRProcessor.from_pretrained(str(model_dir))
        self.trocr_model = VisionEncoderDecoderModel.from_pretrained(str(model_dir))
        self.trocr_model.to(self.ocr_device)
        self.trocr_model.eval()
        self.ocr_loaded = True
        self.logger.info("TrOCR loaded on %s: %s", self.ocr_device, model_dir.name)

        if self.ocr_device == "cuda" and not torch.cuda.is_available():  # defensive
            self.ocr_device = "cpu"

    def unload(self) -> None:
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
