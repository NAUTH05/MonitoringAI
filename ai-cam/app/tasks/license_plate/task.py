"""License plate recognition task.

Pipeline (ported from the production VPS task, with camera ownership removed):

    frame
      -> vehicle YOLO + ByteTrack (persistent tracking)
      -> vehicle crop
      -> plate YOLO
      -> plate crop validation
      -> TrOCR
      -> VN text normalization
      -> per-track voting
      -> finalized recognition result

Camera acquisition is handled by ``app.sources``; this task only receives
ready-made frames via :meth:`process`.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

from ...config import Settings
from ..base import BaseTask
from .crop import clamp_box, crop_bgr, to_pil_rgb, validate_plate_crop
from .normalize import detect_plate_color, normalize_plate_text


class LicensePlateTask(BaseTask):
    name = "license_plate"
    event_type = "VEHICLE"
    description = (
        "YOLO vehicle detect + ByteTrack -> YOLO plate detect -> TrOCR; "
        "votes the best plate per track before emitting an event."
    )

    def __init__(self, registry: Any, settings: Settings, logger: logging.Logger) -> None:
        self.registry = registry
        self.settings = settings
        self.logger = logger

        self.vehicle_conf = settings.vehicle_conf
        self.plate_conf = settings.plate_conf
        self.min_plate_length = settings.min_plate_length
        self.max_plate_length = settings.max_plate_length
        self.track_stale_frames = settings.track_stale_frames

        self._frame_idx = 0
        self._track_candidates: Dict[int, dict] = {}
        self._best_by_plate: Dict[str, dict] = {}
        self._pending_event_images: Optional[Tuple[np.ndarray, np.ndarray]] = None

    # ── lifecycle ─────────────────────────────────────────────────────────
    def load(self) -> None:
        if self.registry.vehicle_model is None:
            raise RuntimeError("Vehicle model is not loaded")
        if self.registry.plate_model is None:
            self.logger.warning("Plate model is not loaded; plate detection will be skipped")
        if not self.registry.ocr_loaded:
            self.logger.warning("TrOCR is not loaded; OCR will be skipped")
        self.logger.info(
            "LicensePlateTask ready | vehicle_classes=%s plate_classes=%s",
            self.registry.vehicle_names,
            self.registry.plate_names,
        )

    # ── inference ─────────────────────────────────────────────────────────
    def process(self, frame: np.ndarray, context: Optional[dict] = None) -> dict:
        self._pending_event_images = None
        empty = {"vehicles": [], "count": 0, "finalized_plates": [], "reason": ""}
        if frame is None or frame.size == 0:
            return {**empty, "reason": "empty frame"}
        if self.registry.vehicle_model is None:
            return {**empty, "reason": "vehicle model unavailable"}

        self._frame_idx += 1
        h, w = frame.shape[:2]
        vehicles_out: List[dict] = []
        predict_kwargs = self.registry.yolo_predict_kwargs()

        try:
            results = self.registry.vehicle_model.track(
                frame, persist=True, tracker="bytetrack.yaml", **predict_kwargs
            )[0]
        except Exception as exc:
            self.logger.exception("Vehicle tracking failed: %s", exc)
            return {**empty, "reason": f"tracking error: {exc}"}

        active_track_ids: set = set()

        if results.boxes.id is not None:
            boxes = results.boxes.xyxy.int().cpu().tolist()
            track_ids = results.boxes.id.int().cpu().tolist()
            class_ids = results.boxes.cls.int().cpu().tolist()
            confs = results.boxes.conf.cpu().tolist()
            active_track_ids = set(track_ids)

            for box, track_id, cls_id, veh_conf in zip(boxes, track_ids, class_ids, confs):
                if veh_conf < self.vehicle_conf:
                    continue
                vehicle_type = self.registry.vehicle_names.get(int(cls_id))
                if vehicle_type is None:
                    continue

                clean = clamp_box(box, w, h)
                if clean is None:
                    continue
                vx1, vy1, vx2, vy2 = clean
                vehicle_crop = frame[vy1:vy2, vx1:vx2]
                if vehicle_crop.size == 0:
                    continue

                vehicle_entry = {
                    "vehicle_box": [vx1, vy1, vx2, vy2],
                    "vehicle_type": vehicle_type,
                    "vehicle_conf": round(float(veh_conf), 3),
                    "track_id": int(track_id),
                    "plate_box": None,
                    "plate_text": "",
                    "plate_conf": 0.0,
                    "plate_color": "unknown",
                    "has_plate": False,
                }

                track_state = self._track_candidates.setdefault(
                    int(track_id), {"last_seen": self._frame_idx, "votes": {}, "best_for_text": {}}
                )
                track_state["last_seen"] = self._frame_idx

                plate_result = self._detect_plate(vehicle_crop)
                if plate_result is not None:
                    plate_box, plate_conf, plate_crop = plate_result
                    px1 = vx1 + plate_box[0]
                    py1 = vy1 + plate_box[1]
                    px2 = vx1 + plate_box[2]
                    py2 = vy1 + plate_box[3]

                    raw_text, ocr_conf = self._run_trocr(plate_crop)
                    plate_text = normalize_plate_text(
                        raw_text, self.min_plate_length, self.max_plate_length
                    )
                    plate_color = detect_plate_color(plate_crop)

                    if plate_text.isalnum() and (
                        self.min_plate_length <= len(plate_text) <= self.max_plate_length
                    ):
                        vehicle_entry.update(
                            {
                                "plate_box": [px1, py1, px2, py2],
                                "plate_text": plate_text,
                                "plate_conf": round(float(ocr_conf), 3),
                                "plate_color": plate_color,
                                "has_plate": True,
                            }
                        )
                        overall_score = float(veh_conf) * float(plate_conf) * float(ocr_conf)
                        track_state["votes"][plate_text] = (
                            track_state["votes"].get(plate_text, 0.0) + overall_score
                        )
                        best_for_text = track_state["best_for_text"].get(plate_text)
                        if best_for_text is None or overall_score > best_for_text["score"]:
                            track_state["best_for_text"][plate_text] = {
                                "score": overall_score,
                                "track_id": int(track_id),
                                "vehicle_type": vehicle_type,
                                "plate_text": plate_text,
                                "plate_color": plate_color,
                                "vehicle_conf": float(veh_conf),
                                "plate_conf": float(plate_conf),
                                "ocr_conf": float(ocr_conf),
                                "vehicle_crop": vehicle_crop.copy(),
                                "plate_crop": plate_crop.copy(),
                            }

                vehicles_out.append(vehicle_entry)

        finalized = self._finalize_stale_tracks(active_track_ids)
        return {
            "vehicles": vehicles_out,
            "count": len(vehicles_out),
            "finalized_plates": finalized,
            "reason": "",
        }

    # ── plate detection ───────────────────────────────────────────────────
    def _detect_plate(
        self, vehicle_crop: np.ndarray
    ) -> Optional[Tuple[List[int], float, np.ndarray]]:
        if self.registry.plate_model is None or vehicle_crop.size == 0:
            return None
        try:
            results = self.registry.plate_model(
                vehicle_crop, **self.registry.yolo_predict_kwargs()
            )[0]
            if results.boxes is None or len(results.boxes) == 0:
                return None

            scores = results.boxes.conf.cpu().tolist()
            best_idx = int(np.argmax(scores))
            plate_conf = float(scores[best_idx])
            if plate_conf < self.plate_conf:
                return None

            h, w = vehicle_crop.shape[:2]
            clean = clamp_box(results.boxes[best_idx].xyxy[0].cpu().tolist(), w, h)
            if clean is None:
                return None

            plate_crop = crop_bgr(vehicle_crop, clean, self.settings.plate_crop_padding)
            if plate_crop is None:
                return None
            return [clean[0], clean[1], clean[2], clean[3]], plate_conf, plate_crop
        except Exception as exc:
            self.logger.exception("Plate detection failed: %s", exc)
            return None

    # ── OCR ───────────────────────────────────────────────────────────────
    def _run_trocr(self, plate_img_bgr: np.ndarray) -> Tuple[str, float]:
        if plate_img_bgr is None or plate_img_bgr.size == 0:
            return "", 0.0
        if not self.registry.ocr_loaded:
            return "", 0.0

        valid, reason = validate_plate_crop(
            plate_img_bgr,
            min_w=self.settings.min_plate_crop_w,
            min_h=self.settings.min_plate_crop_h,
            min_aspect=self.settings.min_plate_aspect,
            max_aspect=self.settings.max_plate_aspect,
        )
        if not valid:
            self.logger.debug("Rejected plate crop before OCR: %s", reason)
            return "", 0.0

        try:
            import torch

            processor = self.registry.trocr_processor
            model = self.registry.trocr_model
            device = self.registry.ocr_device

            image = to_pil_rgb(plate_img_bgr)
            pixel_values = processor(image, return_tensors="pt").pixel_values.to(device)

            with torch.no_grad():
                outputs = model.generate(
                    pixel_values,
                    output_scores=True,
                    return_dict_in_generate=True,
                )

            text = processor.tokenizer.batch_decode(
                outputs.sequences, skip_special_tokens=True
            )[0]
            conf = self._sequence_confidence(outputs)
            return text, conf
        except Exception as exc:
            self.logger.exception("TrOCR failed: %s", exc)
            return "", 0.0

    @staticmethod
    def _sequence_confidence(outputs: Any) -> float:
        try:
            import torch

            seq_scores = getattr(outputs, "sequences_scores", None)
            if seq_scores is not None:
                return float(torch.exp(seq_scores[0]))
            scores = getattr(outputs, "scores", None)
            if scores:
                probs = [float(torch.softmax(step[0], dim=-1).max()) for step in scores]
                if probs:
                    return sum(probs) / len(probs)
        except Exception:
            pass
        return 1.0

    # ── finalization / voting ─────────────────────────────────────────────
    def _finalize_stale_tracks(self, active_track_ids: set) -> List[dict]:
        stale_ids = [
            tid
            for tid, cand in self._track_candidates.items()
            if tid not in active_track_ids
            and self._frame_idx - cand.get("last_seen", self._frame_idx) > self.track_stale_frames
        ]

        candidates = []
        for tid in stale_ids:
            state = self._track_candidates.pop(tid, None)
            record = self._finalize_track_candidate(state)
            if record and self._should_save(record):
                candidates.append(record)

        if not candidates:
            return []

        best_record = max(candidates, key=lambda r: r["score"])
        vehicle_crop = best_record.pop("vehicle_crop")
        plate_crop = best_record.pop("plate_crop")
        self._pending_event_images = (vehicle_crop, plate_crop)
        return [best_record]

    @staticmethod
    def _finalize_track_candidate(track_state: Optional[dict]) -> Optional[dict]:
        if not track_state:
            return None
        votes = track_state.get("votes", {})
        best_for_text = track_state.get("best_for_text", {})
        if not votes or not best_for_text:
            return None
        final_text = max(votes.items(), key=lambda kv: kv[1])[0]
        return best_for_text.get(final_text)

    def _should_save(self, record: dict) -> bool:
        plate_text = record["plate_text"]
        previous = self._best_by_plate.get(plate_text)
        if previous is not None and record["score"] <= previous["score"]:
            return False
        self._best_by_plate[plate_text] = {
            k: v for k, v in record.items() if k not in ("vehicle_crop", "plate_crop")
        }
        return True

    # ── annotation ────────────────────────────────────────────────────────
    def annotate(self, frame: np.ndarray, result: dict) -> np.ndarray:
        out = frame.copy()
        for veh in result.get("vehicles", []):
            vx1, vy1, vx2, vy2 = veh["vehicle_box"]
            cv2.rectangle(out, (vx1, vy1), (vx2, vy2), (0, 200, 0), 2)
            label = f"{veh['vehicle_type']} {veh['vehicle_conf']:.0%}"
            _put_label(out, label, vx1, vy1, color=(0, 200, 0))
            if not veh.get("has_plate") or veh["plate_box"] is None:
                continue
            px1, py1, px2, py2 = veh["plate_box"]
            cv2.rectangle(out, (px1, py1), (px2, py2), (0, 220, 255), 2)
            plate_label = veh.get("plate_text", "")
            if veh.get("plate_conf", 0) > 0:
                plate_label += f"  ({veh['plate_conf']:.0%})"
            _put_label(out, plate_label, px1, py1, color=(0, 220, 255), font_scale=0.9)
        return out

    # ── event hooks ───────────────────────────────────────────────────────
    def is_event(self, result: dict) -> bool:
        return bool(result.get("finalized_plates"))

    def event_fields(self, result: dict) -> Optional[dict]:
        finalized = result.get("finalized_plates")
        if not finalized:
            return None
        record = finalized[0]
        return {
            "plate_text": record.get("plate_text"),
            "vehicle_type": record.get("vehicle_type"),
            "plate_color": record.get("plate_color"),
            "confidence": round(float(record.get("score", 0.0)), 4),
        }

    def event_images(
        self, frame: np.ndarray, result: dict
    ) -> Optional[Tuple[np.ndarray, Optional[np.ndarray]]]:
        if self._pending_event_images is None:
            return None
        vehicle_crop, plate_crop = self._pending_event_images
        return vehicle_crop, plate_crop

    def db_record(
        self, fields: dict, image_key: str, thumbnail_key: Optional[str]
    ) -> Optional[dict]:
        """AI-Cam events row (matches the production license-plate schema)."""
        return {
            "result": {
                "plate_text": fields.get("plate_text"),
                "vehicle_type": fields.get("vehicle_type"),
                "plate_color": fields.get("plate_color"),
                "confidence": fields.get("confidence"),
                "image_key": image_key,
                "thumbnail_key": thumbnail_key,
            },
            "plate_text": fields.get("plate_text"),
            "vehicle_type": fields.get("vehicle_type"),
            "plate_color": fields.get("plate_color"),
            "confidence": fields.get("confidence"),
            "image_path": image_key,
            "thumbnail_path": thumbnail_key,
        }


def _put_label(
    frame: np.ndarray,
    text: str,
    x: int,
    y: int,
    color: Tuple[int, int, int],
    font_scale: float = 0.7,
) -> None:
    if not text:
        return
    y = max(16, y)
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 2)
    cv2.rectangle(frame, (x, y - th - 6), (x + tw + 4, y + 2), (0, 0, 0), -1)
    cv2.putText(
        frame, text, (x + 2, y - 2),
        cv2.FONT_HERSHEY_SIMPLEX, font_scale, color, 2,
    )
