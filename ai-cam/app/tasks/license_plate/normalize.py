"""Vietnamese license-plate text normalization and scoring.

Ported from the production task so recognition behaviour is preserved. The
ambiguous-character swaps (0/O, 8/B, 7/1, 5/S) exist because TrOCR commonly
confuses them on plates.
"""
from __future__ import annotations

from typing import Set

AMBIGUOUS_SWAP = {
    "0": "O", "O": "0",
    "8": "B", "B": "8",
    "7": "1", "1": "7",
    "5": "S", "S": "5",
}


def plate_pattern_score(text: str, min_len: int, max_len: int) -> int:
    """Score a plate string against the VN pattern (e.g. 51H12345). -1 if invalid."""
    if not (min_len <= len(text) <= max_len):
        return -1

    score = 0
    if text[0].isdigit() and text[1].isdigit():
        score += 3
    else:
        return -1

    tail1 = text[3:]
    tail2 = text[4:] if len(text) >= 8 else ""

    one_letter_ok = text[2].isalpha() and len(tail1) >= 4 and tail1.isdigit()
    two_letter_ok = (
        len(text) >= 8
        and text[2].isalpha()
        and text[3].isalpha()
        and len(tail2) >= 4
        and tail2.isdigit()
    )

    if two_letter_ok:
        score += 4
    elif one_letter_ok:
        score += 3
    else:
        return -1

    score += min(len(text), 9) - 6
    return score


def generate_ambiguous_candidates(text: str, max_positions: int = 6) -> Set[str]:
    positions = [i for i, ch in enumerate(text) if ch in AMBIGUOUS_SWAP]
    if len(positions) > max_positions:
        positions = positions[:max_positions]

    candidates = {text}
    for pos in positions:
        for candidate in list(candidates):
            swapped = list(candidate)
            swapped[pos] = AMBIGUOUS_SWAP[swapped[pos]]
            candidates.add("".join(swapped))
    return candidates


def choose_best_plate_candidate(raw_text: str, min_len: int, max_len: int) -> str:
    if plate_pattern_score(raw_text, min_len, max_len) >= 0:
        return raw_text

    best_text = raw_text
    best_score = plate_pattern_score(raw_text, min_len, max_len)
    best_changes = 0

    for cand in generate_ambiguous_candidates(raw_text):
        score = plate_pattern_score(cand, min_len, max_len)
        if score < 0:
            continue
        changes = sum(1 for a, b in zip(raw_text, cand) if a != b)
        if score > best_score or (score == best_score and changes < best_changes):
            best_text = cand
            best_score = score
            best_changes = changes

    return best_text


def normalize_plate_text(raw_text: str, min_len: int, max_len: int) -> str:
    cleaned = raw_text.replace(" ", "").replace("-", "").replace(".", "")
    text = "".join(ch for ch in cleaned.upper() if ch.isalnum())
    if not text:
        return text
    return choose_best_plate_candidate(text, min_len, max_len)


def detect_plate_color(plate_img) -> str:
    """Infer the plate background colour (white/yellow/blue/red) from a crop."""
    import cv2
    import numpy as np

    if plate_img is None or getattr(plate_img, "size", 0) == 0:
        return "unknown"
    hsv = cv2.cvtColor(plate_img, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    avg_s, avg_v, avg_h = float(np.mean(s)), float(np.mean(v)), float(np.mean(h))

    if avg_s < 50 and avg_v > 130:
        return "white"
    if 15 <= avg_h <= 35 and avg_s > 60:
        return "yellow"
    if 90 <= avg_h <= 130 and avg_s > 50:
        return "blue"
    if (avg_h < 10 or avg_h > 160) and avg_s > 50:
        return "red"
    return "unknown"
