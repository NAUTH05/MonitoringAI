"""Load the trained models and run one inference pass.

This is DIAGNOSTIC ONLY. It does not train or modify any model file.

Usage:
    .\\.venv\\Scripts\\python.exe scripts\\test_models.py
    .\\.venv\\Scripts\\python.exe scripts\\test_models.py --image path\\to\\frame.jpg
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import Settings, load_dotenv  # noqa: E402
from app.core.model_registry import ModelRegistry  # noqa: E402
from app.tasks.license_plate.task import LicensePlateTask  # noqa: E402


def _grab_webcam_frame(device: int, backend: int = cv2.CAP_DSHOW):
    cap = cv2.VideoCapture(device, backend)
    if not cap.isOpened():
        cap.release()
        return None
    frame = None
    for _ in range(10):
        ok, candidate = cap.read()
        if ok and candidate is not None:
            frame = candidate
    cap.release()
    return frame


def _synthetic_plate() -> np.ndarray:
    img = np.full((64, 220, 3), 255, dtype=np.uint8)
    cv2.putText(img, "51H12345", (8, 46), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 0, 0), 3)
    return img


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", help="optional frame image to test instead of the webcam")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    logger = logging.getLogger("test_models")

    load_dotenv()
    settings = Settings.from_env()

    registry = ModelRegistry(settings, logger)
    registry.load()
    print("\nModel selection:", registry.describe())

    task = LicensePlateTask(registry, settings, logger)
    task.load()

    frame = None
    if args.image:
        frame = cv2.imread(args.image)
        if frame is None:
            print(f"ERROR: could not read image {args.image}")
            return 2
    else:
        frame = _grab_webcam_frame(settings.webcam_device)
        if frame is None:
            print("WARNING: webcam unavailable; using a synthetic frame")
            frame = np.full((640, 1280, 3), 60, dtype=np.uint8)

    t0 = time.time()
    result = task.process(frame)
    dt = (time.time() - t0) * 1000
    print(f"\nInference on frame {frame.shape}: {dt:.1f} ms")
    print(f"  vehicles detected : {result.get('count')}")
    print(f"  finalized plates  : {len(result.get('finalized_plates', []))}")
    for veh in result.get("vehicles", [])[:10]:
        print(f"    track={veh['track_id']} {veh['vehicle_type']} "
              f"conf={veh['vehicle_conf']} plate={veh.get('plate_text') or '-'}")

    print("\nTrOCR smoke test on a synthetic plate image:")
    text, conf = task._run_trocr(_synthetic_plate())
    print(f"  raw='{text}' confidence={conf:.4f}")

    print("\nOK: models loaded and inference executed (no model files were modified).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
