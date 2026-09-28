"""Head pose from InsightFace's 3D landmark model.

face.pose = (pitch, yaw, roll) in degrees, estimated from the 68-point 3D
landmarks. Yaw: head turned left/right; pitch: up/down; roll: tilt.
The sign convention for "left" vs "right" is confirmed in testing and mapped
in the main backend (FACE_YAW_LEFT_SIGN), because it depends on the camera.
"""

from typing import Any


def head_pose(face: Any) -> tuple[float, float, float]:
    """Return (pitch, yaw, roll) rounded to 0.1 degree; zeros if unavailable."""
    pose = getattr(face, "pose", None)
    if pose is None:
        return 0.0, 0.0, 0.0
    pitch, yaw, roll = (round(float(v), 1) for v in pose)
    return pitch, yaw, roll
