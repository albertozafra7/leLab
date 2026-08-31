"""Publish inference camera observations without reopening camera devices."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

PREVIEW_DIR_ENV = "LELAB_INFERENCE_PREVIEW_DIR"
PREVIEW_CAMERAS_ENV = "LELAB_INFERENCE_PREVIEW_CAMERAS"


def preview_filename(camera_key: str) -> str:
    digest = hashlib.sha256(camera_key.encode()).hexdigest()[:16]
    return f"{digest}.jpg"


class FramePublisher:
    def __init__(self, output_dir: Path, camera_keys: list[str], fps: float = 5.0) -> None:
        self.output_dir = output_dir
        self.camera_keys = camera_keys
        self.interval = 1.0 / fps
        self.last_publish = 0.0

    def publish(self, observation: dict[str, Any]) -> None:
        now = time.monotonic()
        if now - self.last_publish < self.interval:
            return
        self.last_publish = now

        import cv2
        import numpy as np

        for camera_key in self.camera_keys:
            frame = observation.get(camera_key)
            if frame is None:
                continue
            if hasattr(frame, "detach"):
                frame = frame.detach().cpu().numpy()
            frame = np.asarray(frame)
            if frame.ndim != 3 or frame.shape[-1] not in (3, 4):
                continue
            color_code = cv2.COLOR_RGBA2BGRA if frame.shape[-1] == 4 else cv2.COLOR_RGB2BGR
            bgr = cv2.cvtColor(frame, color_code)
            ok, encoded = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 70])
            if not ok:
                continue
            destination = self.output_dir / preview_filename(camera_key)
            temporary = destination.with_suffix(".tmp")
            temporary.write_bytes(encoded.tobytes())
            os.replace(temporary, destination)


def install_preview_hook() -> None:
    output = os.environ.get(PREVIEW_DIR_ENV)
    raw_camera_keys = os.environ.get(PREVIEW_CAMERAS_ENV)
    if not output or not raw_camera_keys:
        return

    camera_keys = json.loads(raw_camera_keys)
    if not isinstance(camera_keys, list) or not all(isinstance(key, str) for key in camera_keys):
        raise ValueError(f"{PREVIEW_CAMERAS_ENV} must contain a JSON list of strings")

    output_dir = Path(output)
    output_dir.mkdir(parents=True, exist_ok=True)
    publisher = FramePublisher(output_dir, camera_keys)

    from lerobot.rollout.strategies.core import RolloutStrategy

    original = RolloutStrategy._process_observation_and_notify

    def process_and_publish(self, processors, observation):
        try:
            publisher.publish(observation)
        except Exception as exc:
            logger.warning("Could not publish inference preview frame: %s", exc)
        return original(self, processors, observation)

    RolloutStrategy._process_observation_and_notify = process_and_publish


def main() -> None:
    install_preview_hook()

    from lerobot.scripts.lerobot_rollout import main as rollout_main

    rollout_main()


if __name__ == "__main__":
    main()
