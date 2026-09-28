"""InsightFace buffalo_l engine, loaded ONCE at start-up (spec 10.1).

buffalo_l = SCRFD-10GF detection + ArcFace w600k_r50 (512-d embeddings)
          + 3D 68-point landmarks (head pose). Runs on ONNX Runtime.
"""

import logging
import threading
from dataclasses import dataclass

import numpy as np
from insightface.app import FaceAnalysis

from pose import head_pose
from quality import blur_score

logger = logging.getLogger(__name__)


@dataclass
class FaceData:
    bbox: list[float]
    det_score: float
    face_width_px: float
    blur_score: float
    yaw: float
    pitch: float
    roll: float
    embedding: list[float]


class FaceEngine:
    def __init__(self, model_name: str, det_size: int, ctx_id: int):
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if ctx_id >= 0 else ["CPUExecutionProvider"]
        self.model_name = model_name
        self._app = FaceAnalysis(
            name=model_name,
            allowed_modules=["detection", "recognition", "landmark_3d_68"],
            providers=providers,
        )
        self._app.prepare(ctx_id=ctx_id, det_size=(det_size, det_size))
        # One inference at a time: CPU inference is already multi-threaded inside
        # ONNX Runtime, and parallel calls would only fight over the same cores.
        self._lock = threading.Lock()
        self.providers = sorted({p for m in self._app.models.values() for p in m.session.get_providers()})
        logger.info("Loaded %s with providers %s", model_name, self.providers)

    def analyze(self, bgr_image: np.ndarray) -> list[FaceData]:
        with self._lock:
            faces = self._app.get(bgr_image)
        results: list[FaceData] = []
        for f in faces:
            x1, y1, x2, y2 = (float(v) for v in f.bbox)
            pitch, yaw, roll = head_pose(f)
            results.append(
                FaceData(
                    bbox=[round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
                    det_score=round(float(f.det_score), 4),
                    face_width_px=round(x2 - x1, 1),
                    blur_score=round(blur_score(bgr_image, (x1, y1, x2, y2)), 1),
                    yaw=yaw,
                    pitch=pitch,
                    roll=roll,
                    embedding=[float(v) for v in f.normed_embedding],  # already L2-normalised
                )
            )
        # Largest face first, so callers can reason about "the" face easily.
        results.sort(key=lambda r: r.face_width_px, reverse=True)
        return results
