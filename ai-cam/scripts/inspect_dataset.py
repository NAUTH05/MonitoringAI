"""Inspect the INTRUSION person dataset: counts + bounding-box statistics.

Usage::

    .\\.venv\\Scripts\\python.exe scripts\\inspect_dataset.py
    .\\.venv\\Scripts\\python.exe scripts\\inspect_dataset.py --samples 8 --out-samples data\\dataset_preview
"""
from __future__ import annotations

import argparse
import random
from collections import Counter
from pathlib import Path

AI_CAM_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATASET = AI_CAM_DIR / "datasets" / "intrusion_person"
SPLITS = ("train", "val", "test")
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def _load_boxes(dataset: Path, split: str):
    lbl_dir = dataset / "labels" / split
    boxes = []
    negatives = 0
    for lbl in sorted(lbl_dir.glob("*.txt")):
        text = lbl.read_text(encoding="utf-8").strip()
        if not text:
            negatives += 1
            continue
        for line in text.splitlines():
            parts = line.split()
            if len(parts) == 5:
                try:
                    boxes.append([float(v) for v in parts])
                except ValueError:
                    pass
    return boxes, negatives


def _size_bucket(area: float) -> str:
    if area < 0.01:
        return "small (<1% frame)"
    if area < 0.10:
        return "medium (1-10%)"
    return "large (>10%)"


def inspect(dataset: Path, samples: int, out_samples: Path) -> int:
    if not dataset.exists():
        print(f"ERROR: dataset not found: {dataset}")
        return 2

    print(f"Dataset: {dataset}")
    grand_boxes = 0
    for split in SPLITS:
        images = [p for p in (dataset / "images" / split).glob("*") if p.suffix.lower() in IMAGE_EXTS]
        boxes, negatives = _load_boxes(dataset, split)
        grand_boxes += len(boxes)
        print(f"\n[{split}] {len(images)} images | {len(boxes)} boxes | "
              f"{negatives} negative frames | "
              f"{len(boxes)/max(1,len(images)):.2f} persons/image")

        if not boxes:
            continue
        classes = Counter(int(b[0]) for b in boxes)
        print(f"  classes        : {dict(classes)}")
        sizes = Counter(_size_bucket(b[3] * b[4]) for b in boxes)
        for k in ("small (<1% frame)", "medium (1-10%)", "large (>10%)"):
            print(f"  {k:16s}: {sizes.get(k, 0)}")
        aspect = [b[3] / b[4] for b in boxes if b[4] > 0]
        if aspect:
            aspect.sort()
            print(f"  aspect w/h     : min={aspect[0]:.2f} median={aspect[len(aspect)//2]:.2f} max={aspect[-1]:.2f}")
        # occupancy grid (3x3) of box centres -> shows where people usually are
        grid = Counter()
        for b in boxes:
            gx = min(2, int(b[1] * 3))
            gy = min(2, int(b[2] * 3))
            grid[(gy, gx)] += 1
        print("  centre grid (rows top->bottom):")
        for gy in range(3):
            print("     " + "  ".join(f"{grid.get((gy, gx), 0):4d}" for gx in range(3)))

    print(f"\nTOTAL boxes: {grand_boxes}")
    if grand_boxes == 0:
        print("Dataset is empty/unlabelled — label frames before training.")

    if samples > 0:
        return _render_samples(dataset, samples, out_samples)
    return 0


def _render_samples(dataset: Path, samples: int, out_samples: Path) -> int:
    import cv2

    rng = random.Random(0)
    out_samples.mkdir(parents=True, exist_ok=True)
    drawn = 0
    for split in SPLITS:
        images = [p for p in (dataset / "images" / split).glob("*") if p.suffix.lower() in IMAGE_EXTS]
        rng.shuffle(images)
        for img_path in images[: max(1, samples // 3)]:
            img = cv2.imread(str(img_path))
            if img is None:
                continue
            h, w = img.shape[:2]
            lbl = dataset / "labels" / split / f"{img_path.stem}.txt"
            if lbl.exists():
                for line in lbl.read_text(encoding="utf-8").splitlines():
                    parts = line.split()
                    if len(parts) != 5:
                        continue
                    _, xc, yc, bw, bh = (float(v) for v in parts)
                    x1 = int((xc - bw / 2) * w); y1 = int((yc - bh / 2) * h)
                    x2 = int((xc + bw / 2) * w); y2 = int((yc + bh / 2) * h)
                    cv2.rectangle(img, (x1, y1), (x2, y2), (0, 0, 255), 2)
            dst = out_samples / f"{split}__{img_path.name}"
            cv2.imwrite(str(dst), img)
            drawn += 1
    print(f"\nWrote {drawn} annotated sample(s) to {out_samples}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect the INTRUSION person dataset")
    parser.add_argument("--dataset", default=str(DEFAULT_DATASET))
    parser.add_argument("--samples", type=int, default=0, help="render N annotated samples")
    parser.add_argument("--out-samples", default=str(AI_CAM_DIR / "data" / "dataset_preview"))
    args = parser.parse_args()
    return inspect(Path(args.dataset).resolve(), args.samples, Path(args.out_samples).resolve())


if __name__ == "__main__":
    raise SystemExit(main())
