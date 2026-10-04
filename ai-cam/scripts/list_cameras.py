"""Enumerate available Windows webcams.

Never assume index 0 is correct: this probes indices and (if ffmpeg exists)
lists DirectShow device names too.

Usage:
    .\\.venv\\Scripts\\python.exe scripts\\list_cameras.py
    .\\.venv\\Scripts\\python.exe scripts\\list_cameras.py --max 8
"""
from __future__ import annotations

import argparse
import shutil
import subprocess

import cv2


def probe(max_index: int) -> None:
    print("Probing webcam indices (DirectShow):")
    found = False
    for idx in range(max_index):
        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
        if cap is not None and cap.isOpened():
            ok, frame = cap.read()
            shape = None if frame is None else (frame.shape[1], frame.shape[0])
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = cap.get(cv2.CAP_PROP_FPS)
            print(f"  index={idx}  readable={ok}  reported={w}x{h}@{fps:.0f}  frame={shape}")
            found = True
        cap.release()
    if not found:
        print("  no camera could be opened by OpenCV/DirectShow")


def ffmpeg_devices() -> None:
    exe = shutil.which("ffmpeg")
    if not exe:
        print("\nffmpeg not found on PATH; skipping DirectShow device-name listing.")
        print("Install ffmpeg to use the go2rtc webcam bridge: "
              "https://www.gyan.dev/ffmpeg/builds/ (add bin\\ to PATH).")
        return
    print("\nDirectShow devices reported by ffmpeg:")
    try:
        out = subprocess.run(
            [exe, "-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
            capture_output=True, text=True, timeout=30,
        )
        print(out.stderr.strip())
    except Exception as exc:  # pragma: no cover
        print(f"  ffmpeg device listing failed: {exc}")


def main() -> int:
    parser = argparse.ArgumentParser(description="List local cameras/devices")
    parser.add_argument("--max", type=int, default=6, help="highest device index to probe")
    args = parser.parse_args()
    probe(args.max)
    ffmpeg_devices()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
