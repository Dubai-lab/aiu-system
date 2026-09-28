"""Face login with liveness (spec 8.3), plus the challenge/liveness steps that
attendance marking reuses in Phase 7.

Flow: challenge (single-use, 90 s, random turn direction) -> two photos
(centre + turn) -> quality + liveness -> 1:N identification with pgvector ->
a normal Supabase session created WITHOUT a password (generate_link token).
"""

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import status

from app.core.background import run_in_background
from app.core.config import get_settings
from app.core.errors import AppError
from app.db.selects import PROFILE_SELECT
from app.db.supabase_client import service_client
from app.schemas.face import ChallengeOut, FaceLoginResponse, FrameIn
from app.services import audit_service, face_service_client, rate_limit_service, user_service
from app.services.face_checks import (
    FaceCheckError,
    check_frame,
    check_liveness,
    frontal_rule,
    identify,
    to_pgvector,
    as_unit_vector,
)

logger = logging.getLogger(__name__)

Purpose = Literal["login", "attendance"]
CHALLENGE_SECONDS = 90

FACE_LOGIN_BUCKET = "face_login"
FACE_LOGIN_LIMIT = 5            # failed face logins ...
FACE_LOGIN_WINDOW = 600         # ... per IP per 10 minutes
CHALLENGE_BUCKET = "face_challenge"
CHALLENGE_LIMIT = 30            # challenges per IP per 10 minutes (stops table flooding)


# --------------------------------------------------------------------------- challenges

def _cleanup_old_challenges() -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    service_client().table("face_challenges").delete().lt("expires_at", cutoff).execute()


def create_challenge(purpose: Purpose, *, user_id: str | None = None, ip: str | None = None) -> ChallengeOut:
    """Two steps: look straight, then turn left or right (random, so a pre-recorded
    video cannot know which way to turn)."""
    if ip:
        rate_limit_service.ensure_allowed(CHALLENGE_BUCKET, ip, limit=CHALLENGE_LIMIT, window_seconds=600)
        rate_limit_service.record(CHALLENGE_BUCKET, ip)
    steps = ["center", secrets.choice(["turn_left", "turn_right"])]
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=CHALLENGE_SECONDS)
    row = service_client().table("face_challenges").insert(
        {"purpose": purpose, "user_id": user_id, "steps": steps, "expires_at": expires_at.isoformat(), "ip": ip}
    ).execute().data[0]
    run_in_background(_cleanup_old_challenges)
    return ChallengeOut(challenge_id=row["id"], steps=steps, expires_in=CHALLENGE_SECONDS)


def consume_challenge(challenge_id: str, purpose: Purpose, *, user_id: str | None = None) -> dict[str, Any]:
    """Atomically mark the challenge used. Fails if unknown, expired, already used,
    or issued for another purpose/user - a challenge can never be replayed."""
    invalid = AppError("challenge_invalid", "This face check has expired. Please start again.")
    if not user_service.is_valid_uuid(challenge_id):
        raise invalid
    now = datetime.now(timezone.utc).isoformat()
    query = (
        service_client().table("face_challenges")
        .update({"used_at": now})
        .eq("id", challenge_id).eq("purpose", purpose)
        .is_("used_at", "null").gt("expires_at", now)
    )
    query = query.eq("user_id", user_id) if user_id else query.is_("user_id", "null")
    rows = query.execute().data
    if not rows:
        raise invalid
    return rows[0]


def verify_live_face(challenge: dict[str, Any], frames: list[FrameIn]) -> tuple[list[float], dict[str, Any]]:
    """Quality + liveness for a consumed challenge. Returns (centre embedding, stats).
    Raises FaceCheckError with a user-facing message."""
    s = get_settings()
    steps = list(challenge["steps"])
    if [f.step for f in frames] != steps:
        raise FaceCheckError("bad_frames", "The photos did not match the requested steps. Please start again.")
    center_result, turn_result = face_service_client.analyze([f.image for f in frames])
    center = check_frame(center_result, s, frontal_rule(s))
    turn = check_frame(turn_result, s, None)  # quality only; the turn itself is judged below
    same = check_liveness(center, turn, steps[1], s)
    stats = {"center_yaw": center["yaw"], "turn_yaw": turn["yaw"], "turn_step": steps[1],
             "liveness_similarity": round(same, 4)}
    return center["embedding"], stats


# --------------------------------------------------------------------------- face login

def _fail(reason: str, message: str, ip: str, details: dict[str, Any], actor_id: str | None = None) -> AppError:
    rate_limit_service.record(FACE_LOGIN_BUCKET, ip)
    audit_service.log("auth.face_login_failed", actor_id=actor_id, details={"reason": reason, **details}, ip=ip)
    return AppError(f"face_{reason}", message, status.HTTP_401_UNAUTHORIZED)


def face_login(challenge_id: str, frames: list[FrameIn], ip: str) -> FaceLoginResponse:
    s = get_settings()
    rate_limit_service.ensure_allowed(
        FACE_LOGIN_BUCKET, ip, limit=FACE_LOGIN_LIMIT, window_seconds=FACE_LOGIN_WINDOW,
        message="Too many face login attempts. Please wait 10 minutes or log in with your password.",
    )
    challenge = consume_challenge(challenge_id, "login")

    try:
        embedding, stats = verify_live_face(challenge, frames)
    except FaceCheckError as exc:
        raise _fail(exc.code, exc.message.rstrip(".") + ".", ip, exc.details) from exc

    matches = service_client().rpc(
        "match_faces", {"query": to_pgvector(as_unit_vector(embedding)), "match_count": 2}
    ).execute().data or []
    result = identify(matches, s.FACE_MATCH_THRESHOLD, s.FACE_MATCH_MARGIN)
    scores = {"top1": round(result.top1, 4), "top2": round(result.top2, 4), **stats}
    if result.user_id is None:
        closest = matches[0]["user_id"] if matches else None
        raise _fail("not_recognised", "Face not recognised. Try again, or log in with your password.", ip,
                    {**scores, "closest_user_id": closest})

    found = service_client().table("profiles").select(PROFILE_SELECT).eq("id", result.user_id).maybe_single().execute()
    profile = found.data if found else None
    if not profile or not profile["is_active"]:
        raise _fail("inactive", "Face not recognised. Try again, or log in with your password.", ip, scores,
                    actor_id=result.user_id)

    # A normal Supabase session without a password: generate_link returns a
    # single-use token and does NOT send an email. The browser exchanges it with
    # supabase.auth.verifyOtp({ token_hash, type: 'email' }).
    link = service_client().auth.admin.generate_link({"type": "magiclink", "email": profile["email"]})
    rate_limit_service.clear(FACE_LOGIN_BUCKET, ip)
    audit_service.log("auth.login", actor_id=profile["id"], entity="profile", entity_id=profile["id"],
                      details={"method": "face", **scores}, ip=ip)
    return FaceLoginResponse(token_hash=link.properties.hashed_token, profile=user_service.to_profile_out(profile))
