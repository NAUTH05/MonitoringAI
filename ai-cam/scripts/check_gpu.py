"""Print the full AI-Cam environment: Python, Torch, CUDA, GPU and libraries.

Usage:
    .\\.venv\\Scripts\\python.exe scripts\\check_gpu.py
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.diagnostics import collect_environment  # noqa: E402


def _nvidia_smi() -> str:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return "nvidia-smi not found on PATH"
    try:
        out = subprocess.run(
            [exe, "--query-gpu=name,driver_version,memory.total,memory.used",
             "--format=csv,noheader"],
            capture_output=True, text=True, timeout=15,
        )
        return out.stdout.strip() or out.stderr.strip()
    except Exception as exc:  # pragma: no cover
        return f"nvidia-smi failed: {exc}"


def main() -> int:
    info = collect_environment()
    print(json.dumps(info, indent=2, default=str))
    print("\nnvidia-smi:", _nvidia_smi())
    if not info.get("cuda_available"):
        print("\nWARNING: CUDA is not available. Inference will run on CPU.")
        print("Install a CUDA build of torch, e.g.:")
        print("  pip install --index-url https://download.pytorch.org/whl/cu128 "
              "torch torchvision")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
