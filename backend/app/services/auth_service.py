"""Password login and password changes (spec 8.2 and 8.5)."""

import logging

from fastapi import status

from app.core.errors import AppError
from app.core.security import CurrentUser
from app.db.selects import PROFILE_SELECT
from app.db.supabase_client import new_anon_client, service_client
from app.schemas.auth import ChangePasswordResponse, LoginResponse
from app.services import audit_service, rate_limit_service, user_service

logger = logging.getLogger(__name__)

LOGIN_BUCKET = "login"
LOGIN_LIMIT = 5              # failed attempts ...
LOGIN_WINDOW_SECONDS = 600   # ... per identifier + IP per 10 minutes


def _invalid() -> AppError:
    return AppError("invalid_credentials", "Invalid credentials.", status.HTTP_401_UNAUTHORIZED)


def _find_login_profile(identifier: str) -> dict | None:
    """Staff log in with email; students with their registration number."""
    query = service_client().table("profiles").select(PROFILE_SELECT)
    if "@" in identifier:
        query = query.eq("email", identifier.lower()).in_("role", ["admin", "teacher"])
    else:
        query = query.eq("reg_number", identifier.upper()).eq("role", "student")
    result = query.maybe_single().execute()
    return result.data if result else None


def login(identifier: str, password: str, ip: str) -> LoginResponse:
    identifier = identifier.strip()
    limit_key = f"{identifier.lower()}|{ip}"
    rate_limit_service.ensure_allowed(LOGIN_BUCKET, limit_key, limit=LOGIN_LIMIT, window_seconds=LOGIN_WINDOW_SECONDS)

    profile = _find_login_profile(identifier)
    # Always the same generic message: never reveal whether an account exists.
    if not profile or not profile["is_active"]:
        rate_limit_service.record(LOGIN_BUCKET, limit_key)
        audit_service.log("auth.login_failed", actor_id=profile["id"] if profile else None,
                          details={"method": "password", "identifier": identifier}, ip=ip)
        raise _invalid()

    try:
        auth = new_anon_client().auth.sign_in_with_password({"email": profile["email"], "password": password})
    except Exception:  # noqa: BLE001 - wrong password and auth errors look the same to the user
        rate_limit_service.record(LOGIN_BUCKET, limit_key)
        audit_service.log("auth.login_failed", actor_id=profile["id"],
                          details={"method": "password", "identifier": identifier}, ip=ip)
        raise _invalid()
    if not auth.session:
        raise _invalid()

    rate_limit_service.clear(LOGIN_BUCKET, limit_key)
    audit_service.log("auth.login", actor_id=profile["id"], entity="profile", entity_id=profile["id"],
                      details={"method": "password"}, ip=ip)
    return LoginResponse(
        access_token=auth.session.access_token,
        refresh_token=auth.session.refresh_token,
        expires_at=auth.session.expires_at,
        profile=user_service.to_profile_out(profile),
    )


def change_password(user: CurrentUser, current_password: str, new_password: str,
                    *, ip: str | None = None) -> ChangePasswordResponse:
    """Verify the current password by signing in with it, then set the new one.

    Supabase revokes ALL of the user's sessions when the password changes (including
    the one in this browser), so we sign in again with the new password and hand the
    fresh tokens back; the browser swaps to them and stays logged in.
    """
    user_id, email = user.id, user.email
    try:
        new_anon_client().auth.sign_in_with_password({"email": email, "password": current_password})
    except Exception as exc:  # noqa: BLE001
        raise AppError("wrong_password", "Your current password is incorrect.", status.HTTP_400_BAD_REQUEST) from exc

    db = service_client()
    db.auth.admin.update_user_by_id(user_id, {"password": new_password})
    db.table("profiles").update({"must_change_password": False}).eq("id", user_id).execute()
    # Password changes happen only in the UI, never by voice (spec 8.5).
    audit_service.log("auth.password_change", actor_id=user_id, entity="profile", entity_id=user_id, via="ui", ip=ip)
    user_service.notify_password_changed(user.profile)

    fresh = new_anon_client().auth.sign_in_with_password({"email": email, "password": new_password})
    if not fresh.session:
        raise AppError("session_error", "Password changed. Please log in again with your new password.", 500)
    return ChangePasswordResponse(
        message="Your password has been changed.",
        access_token=fresh.session.access_token,
        refresh_token=fresh.session.refresh_token,
    )
