"""Frame source abstraction.

The AI pipeline never talks to a physical camera directly: it consumes frames
from a :class:`FrameSource`. Switching from the laptop webcam to an IP camera
only changes configuration, not the pipeline.
"""
