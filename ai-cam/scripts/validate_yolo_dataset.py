"""Validate a YOLO detection dataset for the INTRUSION person model.

Checks
------
* every image has a matching label file (empty label = negative frame, allowed)
* every label line is ``<cls> <xc> <yc> <w> <h>`` with ``cls == 0`` (person)
* all coordinates are finite and within ``[0, 1]``; width/height > 0
* orphan label files (no image) are reported
* **near-duplicate leakage**: identical 8x8 average-hash images appearing in
  more than one split are flagged (video frames must not straddle splits)

Exit code is non-zero when hard errors are found, so it can gate training.

Usage::

    .\\.venv\\Scripts\\python.exe scripts\\validate_yolo_dataset.py
    .\\.venv\\Scripts\\python.exe scripts\\validate_yolo_dataset.py --dataset datasets\\intrusion_person
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path

AI_CAM_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATASET = AI_CAM_DIR / "datasets" / "intrusion_person"
SPLITS = ("train", "val", "test")
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def _ahash(path: Path) -> str:
    import cv2
    import numpy as np

    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return "unreadable"
    small = cv2.resize(img, (8, 8), interpolation=cv2.INTER_AREA).astype(np.float32)
    bits = (small > small.mean()).flatten()
    return "".join("1" if b else "0" for b in bits)


def validate(dataset: Path, max_dup_report: int = 20) -> int:
    if not dataset.exists():
        print(f"ERROR: dataset not found: {dataset}")
        return 2

    errors = 0
    warnings = 0
    per_split: dict = {}
    hashes: dict = defaultdict(set)

    for split in SPLITS:
        img_dir = dataset / "images" / split
        lbl_dir = dataset / "labels" / split
        images = sorted(p for p in img_dir.glob("*") if p.suffix.lower() in IMAGE_EXTS)
        labels = sorted(lbl_dir.glob("*.txt"))

        n_boxes = 0
        n_negatives = 0
        n_empty = 0

        for img in images:
            lbl = lbl_dir / f"{img.stem}.txt"
            if not lbl.exists():
                print(f"  [ERROR] missing label for {img.relative_to(dataset)}")
                errors += 1
                continue
            text = lbl.read_text(encoding="utf-8").strip()
            if not text:
                n_negatives += 1
                continue
            for ln, line in enumerate(text.splitlines(), 1):
                line = line.strip()
                if not line:
                    continue
                parts = line.split()
                if len(parts) != 5:
                    print(f"  [ERROR] {lbl.name}:{ln} expected 5 fields, got {len(parts)}")
                    errors += 1
                    continue
                try:
                    cls = int(float(parts[0]))
                    vals = [float(v) for v in parts[1:]]
                except ValueError:
                    print(f"  [ERROR] {lbl.name}:{ln} non-numeric values")
                    errors += 1
                    continue
                if cls != 0:
                    print(f"  [ERROR] {lbl.name}:{ln} class {cls} != 0 (person only)")
                    errors += 1
                xc, yc, w, h = vals
                if not all(0.0 <= v <= 1.0 for v in (xc, yc, w, h)):
                    print(f"  [ERROR] {lbl.name}:{ln} coordinates out of [0,1]: {vals}")
                    errors += 1
                if w <= 0 or h <= 0:
                    print(f"  [ERROR] {lbl.name}:{ln} non-positive size w={w} h={h}")
                    errors += 1
                n_boxes += 1

        # orphan labels
        img_stems = {p.stem for p in images}
        for lbl in labels:
            if lbl.stem not in img_stems:
                print(f"  [WARN] orphan label (no image): {lbl.relative_to(dataset)}")
                warnings += 1

        per_split[split] = {
            "images": len(images), "labels": len(labels),
            "boxes": n_boxes, "negatives": n_negatives,
        }
        n_empty = len(images) - n_negatives

        for img in images:
            hashes[_ahash(img)].add(split)

    print("\n=== Dataset validation summary ===")
    for split, s in per_split.items():
        print(f"  {split:5s}: {s['images']:6d} images | {s['boxes']:7d} boxes | "
              f"{s['negatives']:5d} negative frames")
    total_images = sum(s["images"] for s in per_split.values())
    total_boxes = sum(s["boxes"] for s in per_split.values())
    print(f"  TOTAL: {total_images} images, {total_boxes} boxes")

    leaked = {h: sp for h, sp in hashes.items() if len(sp) > 1 and h != "unreadable"}
    if leaked:
        print(f"\n  [WARN] {len(leaked)} near-duplicate image(s) appear in multiple splits "
              f"-> potential data leakage (group frames by source video before splitting):")
        for h, sp in list(leaked.items())[:max_dup_report]:
            print(f"         {sorted(sp)}  hash={h}")
        warnings += len(leaked)

    if total_images == 0:
        print("\n  [WARN] dataset is EMPTY — nothing to train on yet.")
        print("         Run scripts/prepare_intrusion_dataset.py extract, label the frames,")
        print("         then run scripts/prepare_intrusion_dataset.py split.")

    print(f"\nResult: {errors} error(s), {warnings} warning(s)")
    return 1 if errors else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate the INTRUSION YOLO dataset")
    parser.add_argument("--dataset", default=str(DEFAULT_DATASET))
    args = parser.parse_args()
    return validate(Path(args.dataset).resolve())


if __name__ == "__main__":
    raise SystemExit(main())
