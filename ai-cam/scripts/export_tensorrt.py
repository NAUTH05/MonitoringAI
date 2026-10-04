"""Export the existing .pt YOLO models to TensorRT engines for THIS GPU.

This is NOT training and it NEVER overwrites the original .pt/.onnx files. It
writes ``vehicle_model.engine`` / ``plate_model.engine`` next to the weights,
which the runtime automatically prefers when present and loadable.

TensorRT engines are GPU- and environment-specific. Never copy an engine built
on another machine (e.g. the RTX 5060 Ti) to this laptop.

Prerequisites (NOT installed by default):
    pip install tensorrt onnx onnxslim onnxruntime-gpu
matching your CUDA build.

Usage:
    .\\.venv\\Scripts\\python.exe scripts\\export_tensorrt.py --model all
    .\\.venv\\Scripts\\python.exe scripts\\export_tensorrt.py --model vehicle --imgsz 640
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import Settings, load_dotenv  # noqa: E402

MODELS = {
    "vehicle": ("vehicle_model_path", "vehicle_engine_path"),
    "plate": ("plate_model_path", "plate_engine_path"),
}


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
            "  pip install tensorrt onnx onnxslim onnxruntime-gpu\n"
        )
        return False
    return True


def _export(name: str, settings: Settings, imgsz: int, half: bool, device: int, force: bool) -> bool:
    from ultralytics import YOLO

    pt_attr, engine_attr = MODELS[name]
    pt_path: Path = getattr(settings, pt_attr)
    engine_path: Path = getattr(settings, engine_attr)

    if not pt_path.exists():
        print(f"ERROR: source weights missing for {name}: {pt_path}")
        return False

    if engine_path.exists() and not force:
        print(f"SKIP {name}: {engine_path.name} already exists (use --force to rebuild)")
        return True

    print(f"\nExporting {name}: {pt_path.name} -> {engine_path.name}")
    print(f"  imgsz={imgsz} half={half} device={device}")

    model = YOLO(str(pt_path))
    try:
        exported = model.export(
            format="engine", imgsz=imgsz, device=device,
            quantize=(16 if half else None), verbose=True,
        )
    except TypeError:
        exported = model.export(
            format="engine", imgsz=imgsz, device=device, half=half, verbose=True
        )

    exported_path = Path(str(exported))
    if exported_path.exists() and exported_path.resolve() != engine_path.resolve():
        if engine_path.exists():
            engine_path.unlink()
        exported_path.replace(engine_path)

    if not pt_path.exists():
        print(f"ERROR: original weights disappeared?! {pt_path}")
        return False

    try:
        from ultralytics import YOLO as _YOLO

        _YOLO(str(engine_path))
        print(f"VALIDATED {name}: {engine_path.name} loads correctly")
    except Exception as exc:
        print(f"WARNING: exported engine could not be validated ({exc})")
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Export AI-Cam YOLO models to TensorRT")
    parser.add_argument("--model", choices=["vehicle", "plate", "all"], default="all")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--device", type=int, default=0)
    parser.add_argument("--no-half", action="store_true", help="export FP32 instead of FP16")
    parser.add_argument("--force", action="store_true", help="rebuild even if an engine exists")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    load_dotenv()
    settings = Settings.from_env()

    if not _check_environment():
        return 2

    names = ["vehicle", "plate"] if args.model == "all" else [args.model]
    ok = True
    for name in names:
        ok = _export(name, settings, args.imgsz, not args.no_half, args.device, args.force) and ok

    print("\nDone. Restart AI-Cam to use the new engine(s).")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
