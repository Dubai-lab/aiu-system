"""Face enrollment by an admin (spec 10.4). Only the averaged embedding is stored - never images."""

import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import status

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import CurrentUser
from app.db.supabase_client import service_client
from app.schemas.face import FrameIn
from app.schemas.users import UserDetail
from app.services import audit_service, face_service_client, user_service
from app.services.face_checks import (
    FaceCheckError,
    average_embedding,
    check_frame,
    frontal_rule,
    is_duplicate,
    same_person,
    to_pgvector,
    turn_rule,
)

logger = logging.getLogger(__name__)

Via = Literal["ui", "voice", "system"]

# The 5 enrollment photos, in order: straight, slight left, slight right, slight up, straight again.
ENROLL_STEPS = ("center", "slight_left", "slight_right", "slight_up", "center")
STEP_LABELS = {
    "center": "looking straight",
    "slight_left": "turned slightly left",
    "slight_right": "turned slightly right",
    "slight_up": "looking slightly up",
}


def enroll_face(actor: CurrentUser, user_id: str, consent: bool, frames: list[FrameIn], *,
                via: Via = "ui", ip: str | None = None) -> UserDetail:
    s = get_settings()
    if not consent:
        raise AppError("consent_required", "Please confirm that the user agrees to their face data being used.")
    row = user_service.get_profile_row(user_id)
    if not row["is_active"]:
        raise AppError("user_inactive", "Reactivate this account before enrolling a face.")
    if tuple(f.step for f in frames) != ENROLL_STEPS:
        raise AppError("bad_frames", "Five photos are required: straight, slight left, slight right, slight up, straight.")

    results = face_service_client.analyze([f.image for f in frames])

    # Quality checks on every photo; "straight" photos must also be frontal.
    faces = []
    for index, (frame, result) in enumerate(zip(frames, results), start=1):
        rule = frontal_rule(s) if frame.step == "center" else turn_rule(s)
        try:
            faces.append(check_frame(result, s, rule))
        except FaceCheckError as exc:
            raise AppError(f"face_{exc.code}", f"Photo {index} ({STEP_LABELS[frame.step]}): {exc.message}.") from exc

    embeddings = [f["embedding"] for f in faces]
    if not same_person(embeddings, s.FACE_SAME_PERSON_MIN):
        raise AppError("face_mismatch", "The photos do not all show the same person. Please retake them.")
    embedding = average_embedding(embeddings)

    # One face, one account.
    db = service_client()
    matches = db.rpc("match_faces", {"query": to_pgvector(embedding), "match_count": 3}).execute().data or []
    duplicate = is_duplicate(matches, user_id, s.FACE_MATCH_THRESHOLD)
    if duplicate:
        audit_service.log("face.enroll_blocked_duplicate", actor_id=actor.id, entity="profile", entity_id=user_id,
                          details={"matched_user_id": duplicate["user_id"],
                                   "similarity": round(duplicate["similarity"], 4)}, via=via, ip=ip)
        raise AppError("face_duplicate", "This face is already enrolled for another account.", status.HTTP_409_CONFLICT)

    was_enrolled = bool(row["face_enrolled"])
    db.table("face_embeddings").upsert(
        {
            "user_id": user_id,
            "embedding": to_pgvector(embedding),
            "samples": len(embeddings),
            "model": "buffalo_l",
            "consent_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="user_id",
    ).execute()
    db.table("profiles").update({"face_enrolled": True}).eq("id", user_id).execute()

    audit_service.log(
        "face.reenroll" if was_enrolled else "face.enroll", actor_id=actor.id, entity="profile", entity_id=user_id,
        details={  # quality summary for tuning / the project report - never the embedding itself
            "samples": len(embeddings),
            "min_det_score": round(min(f["det_score"] for f in faces), 3),
            "min_face_width_px": round(min(f["face_width_px"] for f in faces), 1),
            "min_blur_score": round(min(f["blur_score"] for f in faces), 1),
            "yaws": [f["yaw"] for f in faces],
            "closest_other_similarity": round(max((m["similarity"] for m in matches if m["user_id"] != user_id),
                                                  default=0.0), 4),
        },
        via=via, ip=ip,
    )
    return user_service.get_user_detail(user_id)


def remove_face(actor: CurrentUser, user_id: str, *, via: Via = "ui", ip: str | None = None) -> UserDetail:
    user_service.get_profile_row(user_id)  # 404 if missing
    db = service_client()
    db.table("face_embeddings").delete().eq("user_id", user_id).execute()
    db.table("profiles").update({"face_enrolled": False}).eq("id", user_id).execute()
    audit_service.log("face.remove", actor_id=actor.id, entity="profile", entity_id=user_id, via=via, ip=ip)
    return user_service.get_user_detail(user_id)
