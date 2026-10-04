"""Tiny stdlib HTTP server for local diagnostics.

Provides:
    /            HTML page showing the live annotated preview
    /status      JSON runtime status/metrics
    /health      liveness probe
    /preview.jpg latest annotated frame
    /video.mjpeg MJPEG stream (browser-viewable even without go2rtc/ffmpeg)

Bound to localhost by default. It is a development/diagnostic tool only and is
never exposed to the public internet.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Optional


class StatusServer:
    def __init__(
        self,
        host: str,
        port: int,
        status_provider: Callable[[], dict],
        jpeg_provider: Callable[[Optional[str]], Optional[bytes]],
        logger: logging.Logger,
        mjpeg_fps: float = 10.0,
    ) -> None:
        # ``jpeg_provider(camera_id)`` -> latest annotated JPEG for that camera
        # (``None`` = first available). Multi-camera: /preview.jpg?camera=<id>
        self.host = host
        self.port = port
        self.status_provider = status_provider
        self.jpeg_provider = jpeg_provider
        self.logger = logger
        self.mjpeg_interval = 1.0 / max(mjpeg_fps, 1.0)
        self._server: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        handler = _make_handler()
        self._server = ThreadingHTTPServer((self.host, self.port), handler)
        self._server.daemon_threads = True
        self._server.state = {  # type: ignore[attr-defined]
            "status": self.status_provider,
            "jpeg": self.jpeg_provider,
            "logger": self.logger,
            "interval": self.mjpeg_interval,
        }
        self._thread = threading.Thread(target=self._server.serve_forever, name="status-server", daemon=True)
        self._thread.start()
        self.logger.info("Status server listening on http://%s:%d", self.host, self.port)

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None


_INDEX_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>AI-Cam local preview</title>
<style>
body{background:#0b0f14;color:#d5dde7;font-family:Segoe UI,Arial,sans-serif;margin:0;padding:16px}
h1{font-size:16px;margin:0 0 12px}
img{max-width:100%;border:1px solid #253041;border-radius:8px;background:#000}
pre{background:#111823;padding:12px;border-radius:8px;overflow:auto;font-size:12px}
</style></head>
<body>
<h1>AI-Cam local diagnostic preview</h1>
<img src="/video.mjpeg" alt="live preview">
<h1 style="margin-top:16px">Runtime status</h1>
<pre id="s">loading...</pre>
<script>
async function tick(){try{const r=await fetch('/status');document.getElementById('s').textContent=JSON.stringify(await r.json(),null,2)}catch(e){document.getElementById('s').textContent='status unavailable: '+e}}
tick();setInterval(tick,2000);
</script>
</body></html>
"""


def _make_handler():
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def log_message(self, fmt, *args):  # silence default stderr logging
            return

        def _status(self):
            try:
                return self.server.state["status"]()  # type: ignore[attr-defined]
            except Exception:
                return {"error": "status unavailable"}

        def _camera_param(self):
            if "?" not in self.path:
                return None
            from urllib.parse import parse_qs

            query = parse_qs(self.path.split("?", 1)[1])
            values = query.get("camera") or query.get("cameraId")
            return values[0] if values else None

        def _jpeg(self):
            try:
                return self.server.state["jpeg"](self._camera_param())  # type: ignore[attr-defined]
            except Exception:
                return None

        def do_GET(self):  # noqa: N802
            path = self.path.split("?", 1)[0].rstrip("/") or "/"
            if path == "/":
                body = _INDEX_HTML.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            elif path == "/health":
                self._send_json({"status": "ok"})
            elif path == "/status":
                self._send_json(self._status())
            elif path == "/preview.jpg":
                jpeg = self._jpeg()
                if not jpeg:
                    self.send_error(503, "No frame yet")
                    return
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(jpeg)))
                self.end_headers()
                self.wfile.write(jpeg)
            elif path == "/video.mjpeg":
                self._send_mjpeg()
            else:
                self.send_error(404, "Not found")

        def _send_json(self, payload: dict):
            body = json.dumps(payload, default=str).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _send_mjpeg(self):
            boundary = "aicamframe"
            self.send_response(200)
            self.send_header("Content-Type", f"multipart/x-mixed-replace; boundary={boundary}")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            interval = self.server.state["interval"]  # type: ignore[attr-defined]
            try:
                while True:
                    jpeg = self._jpeg()
                    if jpeg:
                        self.wfile.write(f"--{boundary}\r\n".encode())
                        self.wfile.write(b"Content-Type: image/jpeg\r\n")
                        self.wfile.write(f"Content-Length: {len(jpeg)}\r\n\r\n".encode())
                        self.wfile.write(jpeg)
                        self.wfile.write(b"\r\n")
                    time.sleep(interval)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                return

    return Handler
