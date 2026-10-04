"""Plate/vehicle crop helpers with defensive validation.

The production logs showed Transformers warnings caused by extremely small or
malformed plate crops. Every crop that reaches TrOCR is therefore clamped to
the frame and validated for size and aspect ratio first.
"""
from __future__ import annotations

from typing import Optional, Tuple

import cv2
import numpy as np
from PIL import Image

Box = Tuple[int, int, int, int]


def clamp_box(box, width: int, height: int) -> Optional[Box]:
    """Clamp a box to the frame and return it, or None if it is degenerate."""
    if box is None:
        return None
    try:
        x1, y1, x2, y2 = (int(round(float(v))) for v in box)
    except (TypeError, ValueError):
        return None

    x1 = max(0, min(x1, width - 1))
    y1 = max(0, min(y1, height - 1))
    x2 = max(0, min(x2, width))
    y2 = max(0, min(y2, height))
    if x2 <= x1 or y2 <= y1:
        return None
    return x1, y1, x2, y2


def crop_bgr(frame: np.ndarray, box: Box, padding: int = 0) -> Optional[np.ndarray]:
    """Crop a BGR region with optional padding, clamped to the frame."""
    if frame is None or frame.size == 0:
        return None
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = box
    x1 = max(0, x1 - padding)
    y1 = max(0, y1 - padding)
    x2 = min(w, x2 + padding)
    y2 = min(h, y2 + padding)
    if x2 <= x1 or y2 <= y1:
        return None
    crop = frame[y1:y2, x1:x2]
    if crop.size == 0:
        return None
    return crop


def validate_plate_crop(
    crop: Optional[np.ndarray],
    *,
    min_w: int,
    min_h: int,
    min_aspect: float,
    max_aspect: float,
) -> Tuple[bool, str]:
    """Return (is_valid, reason). Reason is empty when valid."""
    if crop is None or crop.size == 0:
        return False, "empty crop"
    if crop.ndim != 3 or crop.shape[2] != 3:
        return False, f"unexpected shape {crop.shape}"
    h, w = crop.shape[:2]
    if w < min_w or h < min_h:
        return False, f"too small ({w}x{h}, min {min_w}x{min_h})"
    aspect = w / float(h)
    if aspect < min_aspect or aspect > max_aspect:
        return False, f"bad aspect ratio {aspect:.2f} (allowed {min_aspect}-{max_aspect})"
    if not np.isfinite(crop).all():
        return False, "non-finite pixels"
    return True, ""


def to_pil_rgb(bgr: np.ndarray) -> Image.Image:
    """Convert a BGR ndarray to a contiguous RGB PIL image for TrOCR."""
    if bgr is None or bgr.size == 0:
        raise ValueError("cannot convert empty image")
    if bgr.ndim == 2:
        bgr = cv2.cvtColor(bgr, cv2.COLOR_GRAY2BGR)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    return Image.fromarray(np.ascontiguousarray(rgb))
