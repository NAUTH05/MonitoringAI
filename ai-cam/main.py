"""AI-Cam entrypoint.

Run with the project virtualenv:
    .\\.venv\\Scripts\\python.exe main.py
or use ``scripts\\run.ps1``.
"""
from __future__ import annotations

import logging
import sys

from app.config import Settings, load_dotenv
from app.core.diagnostics import log_environment
from app.core.pipeline import Pipeline


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)-7s | %(name)-22s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass

    load_dotenv()
    settings = Settings.from_env()
    configure_logging(settings.log_level)
    logger = logging.getLogger("aicam")

    logger.info("AI-Cam local runtime starting")
    log_environment(logger)
    logger.info("Selected configuration: %s", settings)

    Pipeline(settings, logger).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
