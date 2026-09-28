"""AIU face service (FastAPI, port 8001, bound to 127.0.0.1 only) - spec 10.2.

Stateless: it turns images into numbers (embeddings, pose, quality) and makes no
decisions and does no database work. Only the main backend may call it, using
the shared X-Internal-Key header. Images are decoded in memory and discarded;
nothing is ever written to disk.

Run with:  .venv\\Scripts\\uvicorn main:app --host 127.0.0.1 --port 8001
"""

import base64
import binascii
import logging
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import asdict

import cv2
import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

from config import get_settings
from engine import FaceEngine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("face-service")
settings = get_settings()
_engine: FaceEngine | None = None


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    global _engine
    _engine = FaceEngine(settings.MODEL_NAME, settings.DET_SIZE, settings.CTX_ID)  # load once
    yield


app = FastAPI(title="AIU Face Service", version="1.0.0", lifespan=lifespan)


def require_internal_key(x_internal_key: str = Header(default="")) -> None:
    """Reject any caller that does not present the shared secret."""
    expected = settings.FACE_SERVICE_KEY.get_secret_value()
    if not secrets.compare_digest(x_internal_key.encode(), expected.encode()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal key")


class AnalyzeRequest(BaseModel):
    # base64 JPEG/PNG, optionally as a data URL. ~1.4 MB of base64 = ~1 MB of image.
    images: list[str] = Field(min_length=1, max_length=settings.MAX_IMAGES)


class FaceOut(BaseModel):
    bbox: list[float]
    det_score: float
    face_width_px: float
    blur_score: float
    yaw: float
    pitch: float
    roll: float
    embedding: list[float]


class ImageResult(BaseModel):
    face_count: int
    faces: list[FaceOut]
    error: str | None = None


class AnalyzeResponse(BaseModel):
    results: list[ImageResult]


def _decode(image_b64: str) -> np.ndarray:
    if image_b64.startswith("data:"):
        image_b64 = image_b64.split(",", 1)[-1]
    if len(image_b64) > settings.MAX_IMAGE_BYTES * 4 // 3 + 4:
        raise ValueError("image is larger than 1 MB")
    try:
        raw = base64.b64decode(image_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("image is not valid base64") from exc
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("image could not be decoded")
    return image


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok" if _engine else "loading",
        "model": settings.MODEL_NAME,
        "model_loaded": _engine is not None,
        "providers": _engine.providers if _engine else [],
    }


@app.post("/analyze", response_model=AnalyzeResponse, dependencies=[Depends(require_internal_key)])
def analyze(body: AnalyzeRequest) -> AnalyzeResponse:
    if _engine is None:
        raise HTTPException(status_code=503, detail="Model is still loading")
    results: list[ImageResult] = []
    for image_b64 in body.images:
        try:
            image = _decode(image_b64)
        except ValueError as exc:
            results.append(ImageResult(face_count=0, faces=[], error=str(exc)))
            continue
        faces = _engine.analyze(image)
        del image  # nothing is kept
        results.append(ImageResult(face_count=len(faces), faces=[FaceOut(**asdict(f)) for f in faces]))
    return AnalyzeResponse(results=results)
