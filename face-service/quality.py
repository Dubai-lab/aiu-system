"""Image quality measurements (the pass/fail DECISIONS are made in the main backend)."""

import cv2
import numpy as np


def blur_score(bgr_image: np.ndarray, bbox: tuple[float, float, float, float]) -> float:
    """Sharpness of the face crop: variance of the Laplacian. Higher = sharper.

    The crop is resized to a fixed width first, so the score does not depend on
    how large the face is in the frame.
    """
    h, w = bgr_image.shape[:2]
    x1, y1, x2, y2 = bbox
    x1, y1 = max(0, int(x1)), max(0, int(y1))
    x2, y2 = min(w, int(x2)), min(h, int(y2))
    if x2 - x1 < 8 or y2 - y1 < 8:
        return 0.0
    crop = cv2.cvtColor(bgr_image[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)
    scale = 160.0 / crop.shape[1]
    crop = cv2.resize(crop, (160, max(8, int(crop.shape[0] * scale))), interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(crop, cv2.CV_64F).var())
