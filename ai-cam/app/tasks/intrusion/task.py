"""INTRUSION task — person detection + tracking + ROI business logic.

IMPORTANT ARCHITECTURE NOTE
---------------------------
The neural network detects ONE visual class: **person**. There is no
"intrusion" / "inside_roi" object class. An *intrusion* is a runtime state
derived by this task:

    frame
      -> person YOLO (COCO 'person' class, or a custom single-class model)
      -> ByteTrack persistent tracking
      -> per-track person bounding box
      -> bbox ∩ ROI overlap ratio (mask-based, arbitrary polygons)
      -> insideRoi = roiOverlap >= INTRUSION_OVERLAP_THRESHOLD
      -> per-track state machine (debounce / dwell / cooldown)
      -> one INTRUSION event per confirmed entry

The decision is the fraction of the person's BOUNDING BOX that overlaps the ROI
— NOT the bottom-center foot point — so it works on distant / elevated CCTV
(construction sites, utility poles) where the feet may not be visible.

Camera acquisition is owned by ``app.sources``; this task only receives ready
frames via :meth:`process`.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

from ...config import Settings
from ..base import BaseTask
from .geometry import (
    RoiMaskCache,
    clamp_box,
    normalize_polygon,
    polygon_to_pixel,
)
from .state import IntrusionConfig, IntrusionTracker, TrackState

# BGR colours
_COLOR_NEUTRAL = (170, 170, 170)   # person outside the ROI
_COLOR_ENTERING = (0, 165, 255)    # person inside ROI, not yet confirmed
_COLOR_INTRUSION = (0, 0, 255)     # confirmed intrusion
_COLOR_ROI = (255, 0, 255)         # ROI outline


class IntrusionTask(BaseTask):
    name = "intrusion"
    event_type = "INTRUSION"
    description = (
        "Person YOLO + ByteTrack -> person bbox/ROI overlap ratio -> per-track "
        "debounce/dwell -> one INTRUSION event per entry."
    )

    def __init__(
        self,
        registry: Any,
        settings: Settings,
        logger: logging.Logger,
        roi_provider: Any = None,
    ) -> None:
        self.registry = registry
        self.settings = settings
        self.logger = logger
        self.roi_provider = roi_provider
        self.config = IntrusionConfig.from_settings(settings)
        self.tracker = IntrusionTracker(self.config)
        # Caches ONE rasterized ROI mask, rebuilt only when the ROI polygon or
        # the decoded frame size changes (never per person / per frame).
        self._roi_mask = RoiMaskCache()

        self._frame_idx = 0
        self._person_class: Optional[int] = None
        self._pending_event_image: Optional[np.ndarray] = None
        self._static_roi = normalize_polygon(getattr(settings, "roi_polygon_inline", None))

    # ── lifecycle ─────────────────────────────────────────────────────────
    def load(self) -> None:
        if getattr(self.registry, "person_model", None) is None:
            raise RuntimeError(
                "Person model is not loaded. Set PERSON_MODEL_PATH to a YOLO "
                "detector that exposes a 'person' class (see ai-cam/README.md)."
            )
        names = getattr(self.registry, "person_names", {}) or {}
        self._person_class = next(
            (int(k) for k, v in names.items() if str(v).lower() == "person"), None
        )
        if self._person_class is None:
            self.logger.warning(
                "Person model exposes no class named 'person' (names=%s); "
                "falling back to class 0.", names,
            )
            self._person_class = 0
        self.logger.info(
            "IntrusionTask ready | person_class=%s person_conf=%.2f "
            "overlap_threshold=%.2f min_inside_frames=%d dwell_ms=%d cooldown_ms=%d roi_points=%s",
            self._person_class, self.config.person_conf, self.config.overlap_threshold,
            self.config.min_inside_frames, self.config.intrusion_dwell_ms,
            self.config.event_cooldown_ms, len(self._current_roi() or []),
        )

    # ── inference ─────────────────────────────────────────────────────────
    def process(self, frame: np.ndarray, context: Optional[dict] = None) -> dict:
        self._pending_event_image = None
        empty = {
            "detections": [], "violation": False, "new_violations": [],
            "roi": [], "count": 0, "reason": "",
        }
        if frame is None or frame.size == 0:
            return {**empty, "reason": "empty frame"}
        if getattr(self.registry, "person_model", None) is None:
            return {**empty, "reason": "person model unavailable"}

        self._frame_idx += 1
        h, w = frame.shape[:2]

        roi_norm = self._current_roi()
        # Update the cached ROI mask (rebuilt only when ROI / frame size changes).
        self._roi_mask.set_polygon(roi_norm)

        try:
            results = self.registry.person_model.track(
                frame,
                persist=True,
                tracker="bytetrack.yaml",
                conf=self.config.person_conf,
                classes=[self._person_class],
                **self.registry.yolo_predict_kwargs(),
            )[0]
        except Exception as exc:
            self.logger.exception("Person tracking failed: %s", exc)
            return {**empty, "reason": f"tracking error: {exc}"}

        detections: List[dict] = []
        observations: Dict[int, bool] = {}

        if results.boxes is not None and results.boxes.id is not None:
            boxes = results.boxes.xyxy.int().cpu().tolist()
            track_ids = results.boxes.id.int().cpu().tolist()
            confs = results.boxes.conf.cpu().tolist()

            for box, track_id, conf in zip(boxes, track_ids, confs):
                clean = clamp_box(box, w, h)
                if clean is None:
                    continue
                # INTRUSION decision = fraction of the person bbox inside the ROI.
                overlap = self._roi_mask.overlap_ratio(clean, w, h)
                inside = overlap >= self.config.overlap_threshold
                observations[int(track_id)] = inside
                detections.append(
                    {
                        "trackId": int(track_id),
                        "box": [int(v) for v in clean],
                        "confidence": round(float(conf), 3),
                        "roiOverlap": round(float(overlap), 3),
                        "insideRoi": bool(inside),
                    }
                )

        now_ms = time.time() * 1000.0
        decisions = self.tracker.tick(self._frame_idx, now_ms, observations)

        for det in detections:
            decision = decisions.get(det["trackId"])
            det["state"] = decision.state.value if decision else TrackState.OUTSIDE.value
            det["insideMs"] = round(decision.inside_ms, 1) if decision else 0.0

        new_violations = [
            det for det in detections if decisions.get(det["trackId"], None) and
            decisions[det["trackId"]].emit
        ]

        return {
            "detections": detections,
            "violation": bool(new_violations),
            "new_violations": new_violations,
            "roi": [{"x": x, "y": y} for x, y in (roi_norm or [])],
            "count": len(detections),
            "reason": "",
        }

    # ── annotation ────────────────────────────────────────────────────────
    def annotate(self, frame: np.ndarray, result: dict) -> np.ndarray:
        out = frame.copy()
        h, w = out.shape[:2]

        roi = normalize_polygon(result.get("roi"))
        roi_px = polygon_to_pixel(roi, w, h) if roi else None
        if roi_px is not None:
            cv2.polylines(out, [roi_px.astype(np.int32)], True, _COLOR_ROI, 2, cv2.LINE_AA)

        violation_ids = {d["trackId"] for d in result.get("new_violations", [])}

        for det in result.get("detections", []):
            x1, y1, x2, y2 = det["box"]
            state = det.get("state", TrackState.OUTSIDE.value)
            if det["trackId"] in violation_ids or state == TrackState.INSIDE.value:
                color, tag = _COLOR_INTRUSION, "INTRUSION"
            elif det["insideRoi"]:
                color, tag = _COLOR_ENTERING, "ENTERING"
            else:
                color, tag = _COLOR_NEUTRAL, ""

            cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
            # Show WHY the person triggered: ID, confidence and ROI overlap %.
            label = (
                f"ID {det['trackId']}  {det['confidence']:.0%}"
                f" | ROI {det.get('roiOverlap', 0.0):.0%}"
            )
            if tag:
                label = f"{tag}  {label}"
            _put_label(out, label, x1, y1, color)

        if result.get("new_violations"):
            _put_banner(out, "INTRUSION DETECTED", _COLOR_INTRUSION)
        return out

    # ── event hooks ───────────────────────────────────────────────────────
    def is_event(self, result: dict) -> bool:
        return bool(result.get("new_violations"))

    def event_fields(self, result: dict) -> Optional[dict]:
        violations = result.get("new_violations")
        if not violations:
            return None
        det = violations[0]
        return {
            "confidence": float(det.get("confidence", 0.0)),
            "track_id": det.get("trackId"),
            "roi_overlap": det.get("roiOverlap"),
            "roi_points": len(result.get("roi", [])),
        }

    def event_images(
        self, frame: np.ndarray, result: dict
    ) -> Optional[Tuple[np.ndarray, Optional[np.ndarray]]]:
        """Evidence image = the full annotated frame (ROI + violating bbox)."""
        annotated = self.annotate(frame, result)
        self._pending_event_image = annotated
        return annotated, None

    def db_record(
        self, fields: dict, image_key: str, thumbnail_key: Optional[str]
    ) -> Optional[dict]:
        """Generic AI-Cam DB row (plate columns stay NULL, so the license-plate
        page — which filters ``plate_text IS NOT NULL`` — is unaffected)."""
        return {
            "result": {
                "task": self.name,
                "event_type": self.event_type,
                "track_id": fields.get("track_id"),
                "roi_overlap": fields.get("roi_overlap"),
                "confidence": fields.get("confidence"),
                "image_key": image_key,
                "thumbnail_key": thumbnail_key,
            },
            "plate_text": None,
            "vehicle_type": None,
            "plate_color": None,
            "confidence": fields.get("confidence"),
            "image_path": image_key,
            "thumbnail_path": thumbnail_key,
        }

    # ── helpers ───────────────────────────────────────────────────────────
    def _current_roi(self):
        raw = None
        if self.roi_provider is not None:
            raw = self.roi_provider.current()
        if raw:
            return normalize_polygon(raw) or self._static_roi
        return self._static_roi

    def status_extra(self) -> dict:
        return {
            "roi": self._current_roi(),
            "roi_source": self.roi_provider.describe() if self.roi_provider else None,
            "overlap_threshold": self.config.overlap_threshold,
            "active_tracks": len(self.tracker.active_track_ids()),
        }


def _put_label(
    frame: np.ndarray,
    text: str,
    x: int,
    y: int,
    color: Tuple[int, int, int],
    font_scale: float = 0.6,
) -> None:
    if not text:
        return
    y = max(16, y)
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 2)
    cv2.rectangle(frame, (x, y - th - 6), (x + tw + 4, y + 2), (0, 0, 0), -1)
    cv2.putText(frame, text, (x + 2, y - 2), cv2.FONT_HERSHEY_SIMPLEX, font_scale, color, 2)


def _put_banner(frame: np.ndarray, text: str, color: Tuple[int, int, int]) -> None:
    h, w = frame.shape[:2]
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 1.0, 3)
    x = max(8, (w - tw) // 2)
    y = th + 16
    cv2.rectangle(frame, (x - 8, y - th - 12), (x + tw + 8, y + 8), (0, 0, 0), -1)
    cv2.putText(frame, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 1.0, color, 3)
