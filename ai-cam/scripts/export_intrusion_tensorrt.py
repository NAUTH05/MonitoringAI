"""Export the INTRUSION person detector to a TensorRT engine for THIS GPU.

TensorRT export is an OPTIMIZATION step, NOT training. It:

* reads ``models/intrusion/person_model.pt`` (never modifies it),
* detects the current CUDA GPU,
* exports FP16 by default,
* writes ``models/intrusion/person_model.engine``,
* refuses to overwrite an existing engine unless ``--force`` is given,
* validates that the new engine loads.

Engines are GPU/driver specific — never copy one built on another machine.

Prerequisites (installed separately, matching your CUDA build)::

    .\\.venv\\Scripts\\python.exe -m pip install tensorrt onnx onnxslim onnxruntime-gpu

Usage::

    .\\.venv\\Scripts\\python.exe scripts\\export_intrusion_tensorrt.py
    .\\.venv\\Scripts\\python.exe scripts\\export_intrusion_tensorrt.py --imgsz 640 --force
"""
from __future__ import annotations

import argparse
import logging
from pathlib import Path

AI_CAM_DIR = Path(__file__).resolve().parent.parent
DEFAULT_PT = AI_CAM_DIR / "models" / "intrusion" / "person_model.pt"


def _check_environment() -> bool:
    try:
        import torch
    except ImportError:
        print("ERROR: torch is not installed.")
        return False

    print(f"torch          : {torch.__version__}")
    print(f"torch CUDA     : {torch.version.cuda}")
    print(f"CUDA available : {torch.cuda.is_available()}")
    if not torch.cuda.is_available():
        print("ERROR: TensorRT export requires CUDA. Aborting.")
        return False
    print(f"GPU            : {torch.cuda.get_device_name(0)}")

    try:
        import tensorrt  # noqa: F401

        print(f"tensorrt       : {getattr(tensorrt, '__version__', 'unknown')}")
    except ImportError:
        print(
            "\nERROR: the 'tensorrt' package is not installed in this venv.\n"
            "Install it (version matching your CUDA) before exporting, e.g.:\n"
            "  .\\.venv\\Scripts\\python.exe -m pip install tensorrt onnx onnxslim onnxruntime-gpu\n"
        )
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Export the person detector to TensorRT")
    parser.add_argument("--pt", default=str(DEFAULT_PT), help="source .pt checkpoint")
    parser.add_argument("--engine", default=None, help="output engine path (default: next to .pt)")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--device", type=int, default=0)
    parser.add_argument("--no-half", action="store_true", help="export FP32 instead of FP16")
    parser.add_argument("--force", action="store_true", help="rebuild even if the engine exists")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

    pt_path = Path(args.pt).resolve()
    engine_path = Path(args.engine).resolve() if args.engine else pt_path.with_suffix(".engine")
    half = not args.no_half

    if not pt_path.exists():
        print(f"ERROR: source weights not found: {pt_path}")
        print("       Train one or place the COCO person_model.pt there.")
        return 2
    if engine_path.exists() and not args.force:
        print(f"SKIP: {engine_path.name} already exists (use --force to rebuild).")
        print("      The runtime prefers a loadable engine automatically.")
        return 0

    if not _check_environment():
        return 2

    from ultralytics import YOLO

    print(f"\nExporting: {pt_path.name} -> {engine_path.name} (imgsz={args.imgsz} half={half})")
    model = YOLO(str(pt_path))
    try:
        exported = model.export(
            format="engine", imgsz=args.imgsz, device=args.device,
            quantize=(16 if half else None), verbose=True,
        )
    except TypeError:
        exported = model.export(
            format="engine", imgsz=args.imgsz, device=args.device, half=half, verbose=True
        )

    exported_path = Path(str(exported))
    if exported_path.exists() and exported_path.resolve() != engine_path.resolve():
        if engine_path.exists():
            engine_path.unlink()
        exported_path.replace(engine_path)

    if not pt_path.exists():
        print(f"ERROR: original .pt disappeared?! {pt_path}")
        return 1

    try:
        YOLO(str(engine_path))
        print(f"VALIDATED: {engine_path.name} loads correctly.")
    except Exception as exc:
        print(f"WARNING: exported engine could not be validated ({exc})")
        return 1

    print("\nDone. Restart AI-Cam to use the new engine (it is preferred automatically).")
    print("Reminder: this is inference optimization only — the .pt model is unchanged.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
