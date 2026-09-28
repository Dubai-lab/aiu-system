"""HTTP client for the local face service (port 8001). Only the backend calls it."""

import logging
from functools import lru_cache
from typing import Any

import httpx
from fastapi import status

from app.core.config import get_settings
from app.core.errors import AppError

logger = logging.getLogger(__name__)


def _unavailable() -> AppError:
    return AppError("face_service_unavailable",
                    "Face recognition is not available right now. Please try again shortly or use your password.",
                    status.HTTP_503_SERVICE_UNAVAILABLE)


@lru_cache
def _client() -> httpx.Client:
    s = get_settings()
    return httpx.Client(
        base_url=s.FACE_SERVICE_URL,
        headers={"X-Internal-Key": s.FACE_SERVICE_KEY.get_secret_value()},
        timeout=httpx.Timeout(s.FACE_SERVICE_TIMEOUT_SECONDS, connect=3.0),
    )


def analyze(images: list[str]) -> list[dict[str, Any]]:
    """Send base64 images; returns one result per image:
    {face_count, faces: [{bbox, det_score, face_width_px, blur_score, yaw, pitch, roll, embedding}], error}."""
    try:
        response = _client().post("/analyze", json={"images": images})
    except httpx.HTTPError as exc:
        logger.warning("Face service unreachable: %s", exc)
        raise _unavailable() from exc
    if response.status_code != 200:
        logger.error("Face service returned %s: %s", response.status_code, response.text[:300])
        raise _unavailable()
    return response.json()["results"]


def health() -> dict[str, Any]:
    try:
        response = _client().get("/health", timeout=3.0)
        return response.json()
    except httpx.HTTPError:
        return {"status": "offline", "model_loaded": False}
