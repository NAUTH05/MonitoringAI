"""Prepare the INTRUSION person dataset (extract frames + group-aware split).

This tool NEVER invents labels. It extracts frames from your CCTV videos into a
raw pool, and later splits *labelled* frames into train/val/test **grouped by
source video** so near-identical consecutive frames cannot leak across splits.

Typical Windows PowerShell flow::

    cd C:\\Work\\PROJECTS\\monitoringAI\\ai-cam

    # 1. Extract frames (one group per source video) into the raw pool
    .\\.venv\\Scripts\\python.exe scripts\\prepare_intrusion_dataset.py extract `
        --source "D:\\cctv_footage" --fps 1

    # 2. Label the pooled frames with any YOLO tool (e.g. LabelImg / CVAT /
    #    Roboflow). Labels must sit NEXT TO the image as <stem>.txt in the
    #    standard YOLO format (class 0 = person). Empty .txt = negative frame.

    # 3. Split the labelled pool into the dataset (group-aware)
    .\\.venv\\Scripts\\python.exe scripts\\prepare_intrusion_dataset.py split `
        --val 0.2 --test 0.1 --seed 42

    # 4. Inspect / validate
    .\\.venv\\Scripts\\python.exe scripts\\inspect_dataset.py
    .\\.venv\\Scripts\\python.exe scripts\\validate_yolo_dataset.py

Only class id ``0`` (person) is accepted.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import sys
from pathlib import Path

AI_CAM_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATASET = AI_CAM_DIR / "datasets" / "intrusion_person"

VIDEO_EXTS = {".mp4", ".avi", ".mkv", ".mov", ".mpg", ".mpeg", ".m4v", ".ts", ".wmv"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


# ── helpers ───────────────────────────────────────────────────────────────
def _iter_sources(source: Path):
    if source.is_file():
        yield source
        return
    for p in sorted(source.rglob("*")):
        if p.is_file() and (p.suffix.lower() in VIDEO_EXTS or p.suffix.lower() in IMAGE_EXTS):
            yield p


def _safe(name: str) -> str:
    keep = [c if (c.isalnum() or c in "-_.") else "_" for c in name]
    return "".join(keep)[:80]


def extract(source: Path, dataset: Path, fps: float, max_per_group: int, overwrite: bool) -> int:
    import cv2

    if not source.exists():
        print(f"ERROR: source not found: {source}")
        return 2

    pool = dataset / "_pool"
    pool.mkdir(parents=True, exist_ok=True)
    manifest: dict = {"source": str(source), "fps": fps, "groups": {}}

    for src in _iter_sources(source):
        group = _safe(src.stem)
        out_dir = pool / group
        if out_dir.exists() and not overwrite:
            n = len(list(out_dir.glob("*.jpg")))
            print(f"SKIP {group}: already extracted ({n} frames) — use --overwrite")
            manifest["groups"][group] = {"source": str(src), "frames": n}
            continue

        if src.suffix.lower() in IMAGE_EXTS:
            out_dir.mkdir(parents=True, exist_ok=True)
            dst = out_dir / f"{group}_{_safe(src.name)}"
            shutil.copy2(src, dst)
            manifest["groups"][group] = {"source": str(src), "frames": 1}
            print(f"COPIED {src.name} -> {dst.relative_to(dataset)}")
            continue

        # video
        cap = cv2.VideoCapture(str(src))
        if not cap.isOpened():
            print(f"WARN: cannot open video {src}")
            continue
        video_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        step = max(1, int(round(video_fps / max(fps, 0.01))))
        out_dir.mkdir(parents=True, exist_ok=True)
        saved = 0
        idx = 0
        while saved < max_per_group:
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            if idx % step == 0:
                dst = out_dir / f"frame_{saved:06d}.jpg"
                cv2.imwrite(str(dst), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
                saved += 1
            idx += 1
        cap.release()
        manifest["groups"][group] = {
            "source": str(src), "frames": saved, "video_fps": round(video_fps, 2)
        }
        print(f"EXTRACTED {group}: {saved} frames (video_fps={video_fps:.1f}, step={step})")

    (pool / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    total = sum(g.get("frames", 0) for g in manifest["groups"].values())
    print(f"\nPool ready: {len(manifest['groups'])} groups, {total} frames -> {pool}")
    print("Next: label frames (class 0 = person) with <stem>.txt next to each image,")
    print("      then run: prepare_intrusion_dataset.py split")
    return 0


def _pool_groups(pool: Path):
    if not pool.exists():
        return []
    return sorted(p for p in pool.iterdir() if p.is_dir())


def split(dataset: Path, val: float, test: float, seed: int, min_labels: int) -> int:
    pool = dataset / "_pool"
    groups = _pool_groups(pool)
    if not groups:
        print(f"ERROR: no extracted frames found in {pool}.")
        print("       Run the 'extract' step first.")
        return 2

    # Each group = one source video => never split a group across sets.
    group_images: dict = {}
    unlabelled = 0
    labelled = 0
    for g in groups:
        imgs = sorted(p for p in g.glob("*") if p.suffix.lower() in IMAGE_EXTS)
        if not imgs:
            continue
        group_images[g.name] = imgs
        for img in imgs:
            if (img.with_suffix(".txt")).exists():
                labelled += 1
            else:
                unlabelled += 1

    if labelled < min_labels:
        print(f"ERROR: only {labelled} labelled frames found (need >= {min_labels}).")
        print("       Label the pooled frames first (YOLO <stem>.txt, class 0 = person).")
        print("       Unlabelled frames are ignored by the split to avoid fake ground truth.")
        return 2

    names = sorted(group_images.keys())
    rng = random.Random(seed)
    rng.shuffle(names)

    n = len(names)
    n_test = int(round(n * test))
    n_val = int(round(n * val))
    test_groups = set(names[:n_test])
    val_groups = set(names[n_test:n_test + n_val])
    train_groups = set(names[n_test + n_val:])
    if n >= 3 and not train_groups:
        train_groups = {names[-1]}
        val_groups.discard(names[-1])

    split_map = {}
    for name in names:
        if name in test_groups:
            split_map[name] = "test"
        elif name in val_groups:
            split_map[name] = "val"
        else:
            split_map[name] = "train"

    counts = {"train": 0, "val": 0, "test": 0}
    neg_counts = {"train": 0, "val": 0, "test": 0}
    for split_name in ("train", "val", "test"):
        for sub in ("images", "labels"):
            (dataset / sub / split_name).mkdir(parents=True, exist_ok=True)
        for f in (dataset / "images" / split_name).glob("*"):
            if f.name != ".gitkeep":
                f.unlink()
        for f in (dataset / "labels" / split_name).glob("*"):
            if f.name != ".gitkeep":
                f.unlink()

    for group, imgs in group_images.items():
        s = split_map[group]
        for img in imgs:
            lbl = img.with_suffix(".txt")
            if not lbl.exists():
                continue  # ignore unlabelled frames (no fake labels)
            # Prefix the filename with the group so stems stay unique.
            stem = f"{group}__{img.stem}"
            shutil.copy2(img, dataset / "images" / s / f"{stem}{img.suffix.lower()}")
            shutil.copy2(lbl, dataset / "labels" / s / f"{stem}.txt")
            counts[s] += 1
            if lbl.stat().st_size == 0:
                neg_counts[s] += 1

    manifest = {
        "seed": seed, "val": val, "test": test,
        "groups": split_map, "counts": counts, "negatives": neg_counts,
        "unlabelled_ignored": unlabelled,
    }
    (dataset / "split_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print("Group-aware split complete (no source video spans two splits):")
    for s in ("train", "val", "test"):
        print(f"  {s:5s}: {counts[s]:5d} labelled frames ({neg_counts[s]} negatives, "
              f"{len([g for g,v in split_map.items() if v==s])} groups)")
    if unlabelled:
        print(f"  (ignored {unlabelled} unlabelled frames)")
    print(f"\nManifest: {dataset / 'split_manifest.json'}")
    return 0


def status(dataset: Path) -> int:
    print(f"Dataset: {dataset}")
    pool = dataset / "_pool"
    if pool.exists():
        groups = _pool_groups(pool)
        total = sum(len(list(g.glob('*'))) for g in groups)
        print(f"  raw pool   : {len(groups)} groups, {total} files")
    for s in ("train", "val", "test"):
        imgs = [p for p in (dataset / "images" / s).glob("*") if p.name != ".gitkeep"]
        lbls = [p for p in (dataset / "labels" / s).glob("*") if p.name != ".gitkeep"]
        print(f"  {s:5s}      : {len(imgs)} images, {len(lbls)} labels")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare the INTRUSION person dataset")
    parser.add_argument("--dataset", default=str(DEFAULT_DATASET), help="dataset root")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_ex = sub.add_parser("extract", help="extract frames from videos/images into the raw pool")
    p_ex.add_argument("--source", required=True, help="folder (or file) with videos/images")
    p_ex.add_argument("--fps", type=float, default=1.0, help="frames per second to sample")
    p_ex.add_argument("--max-per-group", type=int, default=2000)
    p_ex.add_argument("--overwrite", action="store_true")

    p_sp = sub.add_parser("split", help="group-aware split of labelled pool -> dataset")
    p_sp.add_argument("--val", type=float, default=0.2)
    p_sp.add_argument("--test", type=float, default=0.1)
    p_sp.add_argument("--seed", type=int, default=42)
    p_sp.add_argument("--min-labels", type=int, default=20)

    sub.add_parser("status", help="show dataset counts")

    args = parser.parse_args()
    dataset = Path(args.dataset).resolve()

    if args.cmd == "extract":
        return extract(Path(args.source).resolve(), dataset, args.fps, args.max_per_group, args.overwrite)
    if args.cmd == "split":
        return split(dataset, args.val, args.test, args.seed, args.min_labels)
    return status(dataset)


if __name__ == "__main__":
    raise SystemExit(main())
