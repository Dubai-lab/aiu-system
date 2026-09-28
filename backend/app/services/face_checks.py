"""Pure decision functions for face quality and matching (spec 10.3-10.5).

No I/O here, so every rule can be unit-tested with synthetic face-service output.
"""

from dataclasses import dataclass
from typing import Any

import numpy as np

from app.core.config import Settings


class FaceCheckError(Exception):
    """A frame failed a check. `message` is safe to show to the user."""

    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}  # measurements for the audit log (tuning / report)


@dataclass(frozen=True)
class PoseRule:
    max_yaw: float
    max_pitch: float


def frontal_rule(s: Settings) -> PoseRule:
    return PoseRule(s.FACE_MAX_FRONTAL_YAW, s.FACE_MAX_FRONTAL_PITCH)


def turn_rule(s: Settings) -> PoseRule:
    return PoseRule(s.FACE_MAX_TURN_YAW, s.FACE_MAX_TURN_PITCH)


def check_frame(result: dict[str, Any], s: Settings, pose: PoseRule | None) -> dict[str, Any]:
    """Validate one analyzed frame and return its single face. Raises FaceCheckError."""
    if result.get("error"):
        raise FaceCheckError("bad_image", "The photo could not be read. Please try again.")
    count = result.get("face_count", 0)
    if count == 0:
        raise FaceCheckError("no_face", "No face detected")
    if count > 1:
        raise FaceCheckError("multiple_faces", "Only one person should be in front of the camera")
    face = result["faces"][0]
    if face["det_score"] < s.FACE_MIN_DET_SCORE:
        raise FaceCheckError("low_confidence", "Please face the camera in good light")
    if face["face_width_px"] < s.FACE_MIN_WIDTH_PX:
        raise FaceCheckError("too_small", "Move closer to the camera")
    if face["blur_score"] < s.FACE_MIN_BLUR:
        raise FaceCheckError("blurry", "Hold still - the image is blurry")
    if pose and (abs(face["yaw"]) > pose.max_yaw or abs(face["pitch"]) > pose.max_pitch):
        raise FaceCheckError("bad_pose", "Look straight at the camera" if pose.max_yaw <= 20 else
                             "Turn your head only slightly")
    return face


def as_unit_vector(values: list[float]) -> np.ndarray:
    v = np.asarray(values, dtype=np.float64)
    n = np.linalg.norm(v)
    if n == 0:
        raise FaceCheckError("bad_embedding", "The photo could not be processed. Please try again.")
    return v / n


def average_embedding(embeddings: list[list[float]]) -> np.ndarray:
    """Mean of L2-normalised embeddings, L2-normalised again (spec 10.4)."""
    return as_unit_vector(np.mean([as_unit_vector(e) for e in embeddings], axis=0).tolist())


def same_person(embeddings: list[list[float]], min_similarity: float) -> bool:
    """One person, not a mix of photos: each frame must match the average of the
    OTHER frames (leave-one-out), so an odd photo cannot vouch for itself."""
    if len(embeddings) < 2:
        return True
    for i, e in enumerate(embeddings):
        others = average_embedding(embeddings[:i] + embeddings[i + 1:])
        if float(as_unit_vector(e) @ others) < min_similarity:
            return False
    return True


def to_pgvector(v: np.ndarray) -> str:
    """Postgres pgvector text format: '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{x:.7f}" for x in v.tolist()) + "]"


def is_duplicate(matches: list[dict[str, Any]], own_user_id: str, threshold: float) -> dict[str, Any] | None:
    """First match that belongs to ANOTHER user and is at/above the threshold."""
    for m in matches:
        if m["user_id"] != own_user_id and m["similarity"] >= threshold:
            return m
    return None


# --------------------------------------------------------------------------- liveness + identification

TURN_STEPS = {"turn_left": "left", "turn_right": "right"}


def check_liveness(center_face: dict[str, Any], turn_face: dict[str, Any], turn_step: str, s: Settings) -> float:
    """Liveness decision (spec 8.3 d). The centre frame's frontal pose is checked by
    check_frame(frontal_rule). Here: the turn frame must be turned far enough in the
    REQUESTED direction, and both frames must show the same person (someone moving,
    not two different photos). Returns the centre/turn similarity."""
    direction = TURN_STEPS[turn_step]
    expected_sign = s.FACE_YAW_LEFT_SIGN if direction == "left" else -s.FACE_YAW_LEFT_SIGN
    similarity = float(as_unit_vector(center_face["embedding"]) @ as_unit_vector(turn_face["embedding"]))
    measured = {"turn_step": turn_step, "center_yaw": center_face["yaw"], "turn_yaw": turn_face["yaw"],
                "liveness_similarity": round(similarity, 4)}
    if turn_face["yaw"] * expected_sign < s.FACE_LIVENESS_MIN_TURN_YAW:
        raise FaceCheckError("liveness_turn", f"Turn your head further to the {direction.upper()}", measured)
    if similarity < s.FACE_LIVENESS_SAME_PERSON:
        raise FaceCheckError("liveness_mismatch", "Keep the same person in front of the camera", measured)
    return similarity


@dataclass(frozen=True)
class Identification:
    user_id: str | None
    top1: float
    top2: float

    @property
    def margin(self) -> float:
        return self.top1 - self.top2


def identify(matches: list[dict[str, Any]], threshold: float, margin: float) -> Identification:
    """1:N decision (spec 8.3 e): accept the best match only if it is above the
    threshold AND clearly ahead of the second best."""
    ordered = sorted(matches, key=lambda m: m["similarity"], reverse=True)
    top1 = float(ordered[0]["similarity"]) if ordered else 0.0
    top2 = float(ordered[1]["similarity"]) if len(ordered) > 1 else 0.0
    accepted = bool(ordered) and top1 >= threshold and (top1 - top2) >= margin
    return Identification(ordered[0]["user_id"] if accepted else None, top1, top2)
