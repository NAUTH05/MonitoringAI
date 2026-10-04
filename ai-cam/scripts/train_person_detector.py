"""Train the INTRUSION person detector (single class: person).

This trains a SMALL YOLO detector for a 4 GB RTX 3050 laptop GPU. It refuses to
run unless a real, non-empty dataset exists — it never fabricates data or
pretends training happened.

Conservative defaults (override on the command line)::

    model   = yolov8n.pt   (small, realtime, easy TensorRT export later)
    imgsz   = 640
    batch   = 8            (drop to 4/2 if CUDA OOM)
    device  = 0
    amp     = True
    cache   = False        (do not pin the whole dataset in RAM)
    patience= 30           (early stopping)
    seed    = 0, deterministic = True

Each run goes into a UNIQUE directory (``runs/intrusion_person/<name>_<ts>``),
so previous runs are never overwritten. The best checkpoint is also copied to
``models/intrusion/person_model.pt`` while the original ``best.pt`` stays in the
run directory.

Usage::

    .\\.venv\\Scripts\\python.exe scripts\\train_person_detector.py
    .\\.venv\\Scripts\\python.exe scripts\\train_person_detector.py --epochs 120 --batch 8
    .\\.venv\\Scripts\\python.exe scripts\\train_person_detector.py --batch 4   # if CUDA OOM
"""
from __future__ import annotations

import argparse
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path

import yaml

AI_CAM_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATASET = AI_CAM_DIR / "datasets" / "intrusion_person"
RUNS_DIR = AI_CAM_DIR / "runs" / "intrusion_person"
DEPLOY_MODEL = AI_CAM_DIR / "models" / "intrusion" / "person_model.pt"

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def _count_images(dataset: Path, split: str) -> int:
    d = dataset / "images" / split
    if not d.exists():
        return 0
    return len([p for p in d.glob("*") if p.suffix.lower() in IMAGE_EXTS])


def _prepare_data_yaml(dataset: Path) -> Path:
    """Load data.yaml and force an absolute ``path`` so ultralytics finds it."""
    yml = dataset / "data.yaml"
    if not yml.exists():
        raise FileNotFoundError(f"data.yaml not found: {yml}")
    data = yaml.safe_load(yml.read_text(encoding="utf-8")) or {}
    data["path"] = str(dataset)
    data.setdefault("train", "images/train")
    data.setdefault("val", "images/val")
    if _count_images(dataset, "test"):
        data.setdefault("test", "images/test")
    data["names"] = {0: "person"}
    data["nc"] = 1
    resolved = dataset / "data.resolved.yaml"
    resolved.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    return resolved


def main() -> int:
    parser = argparse.ArgumentParser(description="Train the INTRUSION person detector")
    parser.add_argument("--dataset", default=str(DEFAULT_DATASET))
    parser.add_argument("--model", default="yolov8n.pt", help="base checkpoint (COCO)")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--device", default="0", help="'0' for GPU, 'cpu' for CPU")
    parser.add_argument("--patience", type=int, default=30)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--name", default=None, help="run name (default: auto timestamp)")
    parser.add_argument("--no-amp", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="validate dataset and print the plan only")
    args = parser.parse_args()

    dataset = Path(args.dataset).resolve()
    n_train = _count_images(dataset, "train")
    n_val = _count_images(dataset, "val")
    n_test = _count_images(dataset, "test")
    print(f"Dataset: {dataset}")
    print(f"  train={n_train}  val={n_val}  test={n_test} images")

    if n_train == 0 or n_val == 0:
        print("\nREFUSING TO TRAIN: the dataset is empty or has no validation images.")
        print("What is missing:")
        if n_train == 0:
            print("  - labelled training frames in datasets/intrusion_person/images/train")
        if n_val == 0:
            print("  - labelled validation frames in datasets/intrusion_person/images/val")
        print("\nNext steps:")
        print("  1) scripts/prepare_intrusion_dataset.py extract --source <your CCTV videos>")
        print("  2) label the pooled frames (class 0 = person), YOLO <stem>.txt")
        print("  3) scripts/prepare_intrusion_dataset.py split")
        print("  4) scripts/validate_yolo_dataset.py")
        print("  5) re-run this script")
        print("\nTip: until a custom model exists you can still run intrusion with the")
        print("     COCO-pretrained person_model.pt already in models/intrusion/.")
        return 2

    data_yaml = _prepare_data_yaml(dataset)
    run_name = args.name or f"person_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    print("\nTraining plan:")
    print(f"  model={args.model} data={data_yaml.name} epochs={args.epochs} "
          f"imgsz={args.imgsz} batch={args.batch} device={args.device} amp={not args.no_amp}")
    print(f"  run dir -> {RUNS_DIR / run_name}")
    if args.dry_run:
        print("\n--dry-run: nothing was trained.")
        return 0

    from ultralytics import YOLO

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    model = YOLO(args.model)
    t0 = time.time()
    try:
        results = model.train(
            data=str(data_yaml),
            epochs=args.epochs,
            imgsz=args.imgsz,
            batch=args.batch,
            device=args.device,
            amp=not args.no_amp,
            cache=False,
            patience=args.patience,
            workers=args.workers,
            seed=args.seed,
            deterministic=True,
            plots=True,
            save=True,
            project=str(RUNS_DIR),
            name=run_name,
            exist_ok=False,          # never overwrite a previous run
            resume=args.resume,
            val=True,
        )
    except RuntimeError as exc:
        msg = str(exc).lower()
        if "out of memory" in msg or "cuda" in msg and "memory" in msg:
            print("\nCUDA OUT OF MEMORY. Reduce memory usage and retry:")
            print("  1) --batch 4      (or 2)")
            print(" 2) --imgsz 512")
            print("  3) close other GPU apps (browsers, games, other AI processes)")
            print("  4) set PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True")
            print("\nDo NOT ignore this error: training did not run to completion.")
        raise
    duration = time.time() - t0

    save_dir = Path(getattr(model.trainer, "save_dir", RUNS_DIR / run_name))
    best = Path(getattr(model.trainer, "best", save_dir / "weights" / "best.pt"))
    last = Path(getattr(model.trainer, "last", save_dir / "weights" / "last.pt"))
    best_epoch = int(getattr(model.trainer, "best_epoch", -1))
    metrics = dict(getattr(results, "results_dict", {}) or {})

    print("\n=== Training complete ===")
    print(f"  duration     : {duration/60:.1f} min")
    print(f"  best epoch   : {best_epoch}")
    print(f"  best.pt      : {best}")
    print(f"  last.pt      : {last}")
    for key in (
        "metrics/precision(B)", "metrics/recall(B)",
        "metrics/mAP50(B)", "metrics/mAP50-95(B)",
        "val/box_loss", "val/cls_loss", "val/dfl_loss",
    ):
        if key in metrics:
            print(f"  {key:22s}: {float(metrics[key]):.4f}")

    # Deploy the best checkpoint WITHOUT destroying the run's best.pt.
    if best.exists():
        DEPLOY_MODEL.parent.mkdir(parents=True, exist_ok=True)
        if DEPLOY_MODEL.exists():
            backup = DEPLOY_MODEL.with_suffix(".prev.pt")
            shutil.copy2(DEPLOY_MODEL, backup)
            print(f"  (previous deployed model backed up -> {backup.name})")
        shutil.copy2(best, DEPLOY_MODEL)
        print(f"  deployed     : {DEPLOY_MODEL}")
    else:
        print("  WARNING: best.pt not found; nothing deployed.")
    print("\nNote: metrics above come from the run's own validation split. Do not")
    print("      judge the model on training loss alone — run evaluate_person_detector.py.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
