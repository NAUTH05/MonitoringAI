"""Shared pytest fixtures/configuration for the AI-Cam tests.

Ensures the ``ai-cam`` project root is importable (``import app...``) no matter
where pytest is invoked from.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
