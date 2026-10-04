"""Evaluate the INTRUSION person detector on an image, video, webcam or dataset.

Modes
-----
``--metrics``        run ``model.val()`` on the dataset (val/test split) and
                     print precision / recall / mAP50 / mAP50-95 + losses.
``--image PATH``     single image: print person boxes (and ROI test if --roi).
``--video PATH``     video file: run person detection + tracking + ROI logic,
                     report how many intrusion events would fire.
``--webcam``         laptop webcam (``--device-index``), same as video.

Usage::

    .\\.venv\\Scripts\\python.exe scripts\\evaluate_person_detector.py --metrics
    .\\.venv\\Scripts\\python.exe scripts\\evaluate_person_detector.py --image frame.jpg --roi roi.json
    .\\.venv\\Scripts\\python.exe scripts\\evaluate_person_detector.py --video clip.mp4 --roi roi.json --save-out out.mp4
    .\\.venv\\Scripts\\python.exe scripts\\evaluate_person_detector.py --webcam
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

AI_CAM_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATASET = AI_CAM_DIR / "datasets" / "intrusion_person"
DEFAULT_MODEL = AI_CAM_DIR / "models" / "intrusion" / "person_model.pt"


def _load_roi(path: str | None):
    from app.tasks.intrusion.geometry import normalize_polygon

    if not path:
        return None
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict) and "roiPolygon" in data:
        data = data["roiPolygon"]
    return normalize_polygon(data)


def run_metrics(dataset: Path, model_path: Path, split: str) -> int:
    import yaml
    from ultralytics import YOLO

    if not model_path.exists():
        print(f"ERROR: model not found: {model_path}")
        return 2
    yml = dataset / "data.yaml"
    data = yaml.safe_load(yml.read_text(encoding="utf-8")) or {}
    data["path"] = str(dataset)
    data["names"] = {0: "person"}
    data["nc"] = 1
    resolved = dataset / "data.resolved.yaml"
    resolved.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")

    model = YOLO(str(model_path))
    metrics = model.val(data=str(resolved), split=split, plots=True)
    box = getattr(metrics, "box", None)
    print(f"\n=== {model_path.name} on split '{split}' ===")
    if box is not None:
        print(f"  precision : {float(box.mp):.4f}")
        print(f"  recall    : {float(box.mr):.4f}")
        print(f"  mAP50     : {float(box.map50):.4f}")
        print(f"  mAP50-95  : {float(box.map):.4f}")
    print("  (a high training loss with low mAP means over/under-fitting — trust mAP)")
    return 0


def run_stream(task, source_desc: str, cap, roi, save_out: Path | None) -> int:
    import cv2

    writer = None
    frames = 0
    max_persons = 0
    events = 0
    t0 = time.time()
    while True:
        ok, frame = cap.read()
        if not ok or frame is None:
            break
        frames += 1
        result = task.process(frame)
        max_persons = max(max_persons, result.get("count", 0))
        if result.get("violation"):
            events += 1
        annotated = task.annotate(frame, result)
        if save_out is not None:
            if writer is None:
                h, w = annotated.shape[:2]
                fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                writer = cv2.VideoWriter(str(save_out), fourcc, 20.0, (w, h))
            writer.write(annotated)
        if frames % 30 == 0:
            print(f"  frame {frames}: persons={result.get('count',0)} "
                  f"violations={events}")

    dt = time.time() - t0
    if writer is not None:
        writer.release()
    print(f"\n{source_desc}: {frames} frames in {dt:.1f}s "
          f"({frames/max(dt,1e-6):.1f} fps) | max persons/frame={max_persons} | "
          f"intrusion events={events}")
    if save_out is not None:
        print(f"  annotated output -> {save_out}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate the INTRUSION person detector")
    parser.add_argument("--model", default=str(DEFAULT_MODEL))
    parser.add_argument("--dataset", default=str(DEFAULT_DATASET))
    parser.add_argument("--metrics", action="store_true", help="run dataset validation metrics")
    parser.add_argument("--split", default="val", choices=["train", "val", "test"])
    parser.add_argument("--image", help="single image to test")
    parser.add_argument("--video", help="video file to test")
    parser.add_argument("--webcam", action="store_true", help="use the laptop webcam")
    parser.add_argument("--device-index", type=int, default=0)
    parser.add_argument("--roi", help="ROI polygon JSON (list of {x,y} or {'roiPolygon':[...]})")
    parser.add_argument("--save-out", help="save annotated image/video here")
    parser.add_argument("--conf", type=float, default=0.35)
    args = parser.parse_args()

    sys.path.insert(0, str(AI_CAM_DIR))
    model_path = Path(args.model).resolve()
    roi = _load_roi(args.roi)

    if args.metrics:
        return run_metrics(Path(args.dataset).resolve(), model_path, args.split)

    import cv2

    if not model_path.exists():
        print(f"ERROR: model not found: {model_path}")
        print("       Train one (scripts/train_person_detector.py) or download the COCO one.")
        return 2

    from types import SimpleNamespace
    from app.core.model_registry import ModelRegistry
    from app.tasks.intrusion.task import IntrusionTask

    settings = SimpleNamespace(
        task_name="intrusion", device="auto", use_fp16=True, prefer_tensorrt=True,
        person_model_path=model_path,
        person_engine_path=model_path.with_suffix(".engine"),
        vehicle_model_path=AI_CAM_DIR / "vehicle_model.pt",
        vehicle_engine_path=AI_CAM_DIR / "vehicle_model.engine",
        plate_model_path=AI_CAM_DIR / "plate_model.pt",
        plate_engine_path=AI_CAM_DIR / "plate_model.engine",
        trocr_model_dir=AI_CAM_DIR / "trocr_vn_plate_final",
        person_conf=args.conf, min_inside_frames=3, intrusion_dwell_ms=1000,
        event_cooldown_ms=5000, roi_exit_frames=5, track_lost_frames=30,
        roi_polygon_inline=json.dumps(roi) if roi else None,
    )
    registry = ModelRegistry(settings, __import__("logging").getLogger("eval"))
    registry.load()
    provider = SimpleNamespace(current=lambda: roi, describe=lambda: {"source": "cli"}) if roi else None
    task = IntrusionTask(registry, settings, __import__("logging").getLogger("eval"), roi_provider=provider)
    task.load()

    save_out = Path(args.save_out).resolve() if args.save_out else None

    if args.image:
        frame = cv2.imread(args.image)
        if frame is None:
            print(f"ERROR: cannot read image {args.image}")
            return 2
        result = task.process(frame)
        print(f"persons={result['count']}  violation={result['violation']}")
        for d in result["detections"]:
            print(f"  {d}")
        if save_out:
            cv2.imwrite(str(save_out), task.annotate(frame, result))
            print(f"  annotated -> {save_out}")
        return 0

    if args.video:
        cap = cv2.VideoCapture(args.video)
        if not cap.isOpened():
            print(f"ERROR: cannot open video {args.video}")
            return 2
        return run_stream(task, f"video {Path(args.video).name}", cap, roi, save_out)

    if args.webcam:
        cap = cv2.VideoCapture(args.device_index, cv2.CAP_DSHOW)
        if not cap.isOpened():
            print(f"ERROR: cannot open webcam index {args.device_index}")
            return 2
        print("Press Ctrl+C to stop the webcam test.")
        try:
            return run_stream(task, "webcam", cap, roi, save_out)
        except KeyboardInterrupt:
            return 0

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
