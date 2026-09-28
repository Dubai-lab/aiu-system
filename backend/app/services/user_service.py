"""User/profile business logic (spec 8.1, 8.5).

Every admin action on users lives here ONCE. The REST routes call these
functions today; the voice assistant tools will call the very same functions,
so validation, audit logging and emails behave identically for voice and click.
"""

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import status

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.passwords import generate_default_password
from app.core.security import CurrentUser
from app.db.selects import PROFILE_SELECT
from app.db.supabase_client import service_client
from app.schemas.auth import MeOut, ProfileOut
from app.schemas.users import (
    CourseRef,
    CredentialsEmailStatus,
    RegisterStaffRequest,
    RegisterStudentRequest,
    UpdateUserRequest,
    UserDetail,
    UserListItem,
    UserListResponse,
)
from app.services import audit_service, email_service

logger = logging.getLogger(__name__)

Role = Literal["admin", "teacher", "student"]
Via = Literal["ui", "voice", "system"]

_BAN_FOREVER = "876000h"  # ~100 years: Supabase's way to block sign-in and token refresh


# --------------------------------------------------------------------------- helpers

def _not_found() -> AppError:
    return AppError("not_found", "User not found.", status.HTTP_404_NOT_FOUND)


def is_valid_uuid(value: str | None) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


def get_profile_row(user_id: str) -> dict[str, Any]:
    if not is_valid_uuid(user_id):
        raise _not_found()
    result = service_client().table("profiles").select(PROFILE_SELECT).eq("id", user_id).maybe_single().execute()
    if not result or not result.data:
        raise _not_found()
    return result.data


def to_profile_out(row: dict[str, Any]) -> ProfileOut:
    return ProfileOut.model_validate(row)


def to_me_out(row: dict[str, Any]) -> MeOut:
    """`row` must have been loaded with PROFILE_SELECT (the auth dependency does this)."""
    force = get_settings().FORCE_PASSWORD_CHANGE_ON_FIRST_LOGIN and bool(row["must_change_password"])
    return MeOut.model_validate({**row, "force_password_change": force})


def _ensure_department(department_id: str | None, *, required: bool) -> None:
    if not department_id:
        if required:
            raise AppError("department_required", "Please choose a department.")
        return
    if not is_valid_uuid(department_id):
        raise AppError("department_not_found", "That department does not exist.")
    found = service_client().table("departments").select("id").eq("id", department_id).maybe_single().execute()
    if not found or not found.data:
        raise AppError("department_not_found", "That department does not exist.")


def _login_id(row: dict[str, Any]) -> str:
    return row["reg_number"] if row["role"] == "student" else row["email"]


def _welcome_template(role: str) -> str:
    return {"student": "student_welcome", "teacher": "teacher_welcome", "admin": "admin_welcome"}[role]


def _queue_credentials_email(template: str, row: dict[str, Any], password: str) -> None:
    context: dict[str, Any] = {"full_name": row["full_name"], "email": row["email"], "password": password}
    if template == "student_welcome":
        context["reg_number"] = row["reg_number"]
    elif template in ("teacher_welcome", "admin_welcome"):
        context["role_label"] = "teacher" if row["role"] == "teacher" else "administrator"
    elif template == "password_reset_by_admin":
        context["login_id"] = _login_id(row)
    email_service.queue_email(template, row["email"], context, related_user_id=row["id"])


# --------------------------------------------------------------------------- read

def _search_term(raw: str) -> str:
    """Strip characters that have meaning inside a PostgREST or() filter."""
    return re.sub(r"[,()*%\\:\"']", " ", raw).strip()


def list_users(
    *,
    role: Role | None = None,
    search: str | None = None,
    department_id: str | None = None,
    is_active: bool | None = None,
    level: int | None = None,
    page: int = 1,
    page_size: int = 20,
) -> UserListResponse:
    page = max(1, page)
    page_size = min(max(1, page_size), 100)
    query = service_client().table("profiles").select(
        "id, role, full_name, email, reg_number, staff_title, level, face_enrolled,"
        " must_change_password, is_active, created_at, department:departments(code)",
        count="exact",
    )
    if role:
        query = query.eq("role", role)
    if department_id and is_valid_uuid(department_id):
        query = query.eq("department_id", department_id)
    if is_active is not None:
        query = query.eq("is_active", is_active)
    if level is not None:
        query = query.eq("level", level)
    term = _search_term(search or "")
    if term:
        query = query.or_(f"full_name.ilike.*{term}*,email.ilike.*{term}*,reg_number.ilike.*{term}*")

    start = (page - 1) * page_size
    result = query.order("created_at", desc=True).range(start, start + page_size - 1).execute()
    items = [
        UserListItem.model_validate({**row, "department_code": (row.get("department") or {}).get("code")})
        for row in result.data
    ]
    return UserListResponse(items=items, total=result.count or 0, page=page, page_size=page_size)


def _courses_for(row: dict[str, Any]) -> list[CourseRef]:
    db = service_client()
    if row["role"] == "student":
        data = db.table("enrollments").select("course:courses(id, code, title)").eq("student_id", row["id"]).execute().data
        courses = [r["course"] for r in data if r.get("course")]
    elif row["role"] == "teacher":
        courses = db.table("courses").select("id, code, title").eq("teacher_id", row["id"]).execute().data
    else:
        courses = []
    return sorted((CourseRef.model_validate(c) for c in courses), key=lambda c: c.code)


def get_user_detail(user_id: str) -> UserDetail:
    row = get_profile_row(user_id)
    email = email_service.latest_credentials_email(user_id)
    return UserDetail.model_validate(
        {
            **row,
            "courses": _courses_for(row),
            "credentials_email": CredentialsEmailStatus.model_validate(email) if email else None,
        }
    )


# --------------------------------------------------------------------------- write

def register_user(
    actor: CurrentUser,
    role: Role,
    data: RegisterStudentRequest | RegisterStaffRequest,
    *,
    via: Via = "ui",
    ip: str | None = None,
) -> UserDetail:
    """Create the auth user + profile, audit it and email the login details."""
    db = service_client()

    existing = db.table("profiles").select("id").eq("email", data.email).maybe_single().execute()
    if existing and existing.data:
        raise AppError("email_taken", "A user with this email already exists.", status.HTTP_409_CONFLICT)
    _ensure_department(data.department_id, required=(role in ("student", "teacher")))

    profile: dict[str, Any] = {
        "role": role,
        "full_name": data.full_name,
        "email": data.email,
        "phone": data.phone,
        "department_id": data.department_id,
        "must_change_password": True,
        "created_by": actor.id,
    }
    if isinstance(data, RegisterStudentRequest):
        profile["level"] = data.level
        profile["intake_year"] = data.intake_year
        profile["reg_number"] = db.rpc("next_reg_number", {"p_intake_year": data.intake_year}).execute().data
    else:
        profile["staff_title"] = data.staff_title

    password = generate_default_password()

    # 1. Auth user. Email is marked confirmed so Supabase sends no email of its own.
    try:
        created = db.auth.admin.create_user({"email": data.email, "password": password, "email_confirm": True})
    except Exception as exc:  # noqa: BLE001
        if "already" in str(exc).lower():
            raise AppError("email_taken", "A user with this email already exists.", status.HTTP_409_CONFLICT) from exc
        logger.exception("create_user failed")
        raise AppError("auth_error", "Could not create the login account. Please try again.", 502) from exc
    user_id = created.user.id

    # 2. Profile. If it fails, remove the auth user so no half-created account remains.
    try:
        db.table("profiles").insert({"id": user_id, **profile}).execute()
    except Exception as exc:  # noqa: BLE001
        try:
            db.auth.admin.delete_user(user_id)
        except Exception:  # noqa: BLE001
            logger.exception("Rollback of auth user %s failed", user_id)
        logger.exception("Profile insert failed")
        raise AppError("register_failed", "Could not create the user profile. Please try again.", 500) from exc

    audit_service.log(
        f"user.register_{role}", actor_id=actor.id, entity="profile", entity_id=user_id,
        details={"email": data.email, "reg_number": profile.get("reg_number")}, via=via, ip=ip,
    )
    row = {**profile, "id": user_id}
    _queue_credentials_email(_welcome_template(role), row, password)

    detail = get_user_detail(user_id)
    return detail


def update_user(actor: CurrentUser, user_id: str, data: UpdateUserRequest, *, via: Via = "ui",
                ip: str | None = None) -> UserDetail:
    patch = data.model_dump(exclude_unset=True)
    if "is_active" in patch:  # activation has its own rules (ban, no self-deactivation)
        active = patch.pop("is_active")
        if active is None:
            raise AppError("invalid_field", "is_active must be true or false.")
        set_active(actor, user_id, active, via=via, ip=ip)
        if not patch:
            return get_user_detail(user_id)

    row = get_profile_row(user_id)
    if "level" in patch and row["role"] != "student":
        raise AppError("invalid_field", "Only students have a level.")
    if "staff_title" in patch and row["role"] == "student":
        raise AppError("invalid_field", "Students do not have a staff title.")
    if "department_id" in patch:
        _ensure_department(patch["department_id"], required=row["role"] in ("student", "teacher"))
    if "full_name" in patch and not patch["full_name"]:
        raise AppError("invalid_field", "Full name cannot be empty.")
    if row["role"] == "student" and "level" in patch and patch["level"] is None:
        raise AppError("invalid_field", "A student must have a level.")

    if patch:
        service_client().table("profiles").update(patch).eq("id", user_id).execute()
        audit_service.log("user.update", actor_id=actor.id, entity="profile", entity_id=user_id,
                          details={"fields": sorted(patch)}, via=via, ip=ip)
    return get_user_detail(user_id)


def set_active(actor: CurrentUser, user_id: str, active: bool, *, via: Via = "ui", ip: str | None = None) -> UserDetail:
    """Deactivate/reactivate. Deactivation also bans the auth user, which blocks
    sign-in and token refresh at Supabase itself (not only in our backend)."""
    row = get_profile_row(user_id)
    if user_id == actor.id and not active:
        raise AppError("cannot_deactivate_self", "You cannot deactivate your own account.")
    if row["is_active"] == active:
        return get_user_detail(user_id)

    db = service_client()
    db.auth.admin.update_user_by_id(user_id, {"ban_duration": "none" if active else _BAN_FOREVER})
    db.table("profiles").update({"is_active": active}).eq("id", user_id).execute()
    audit_service.log("user.reactivate" if active else "user.deactivate", actor_id=actor.id,
                      entity="profile", entity_id=user_id, via=via, ip=ip)
    return get_user_detail(user_id)


def reset_password(actor: CurrentUser, user_id: str, *, via: Via = "ui", ip: str | None = None) -> UserDetail:
    """New random default password, emailed to the user. It is never returned or spoken."""
    row = get_profile_row(user_id)
    password = generate_default_password()
    db = service_client()
    db.auth.admin.update_user_by_id(user_id, {"password": password})  # also ends the user's sessions
    db.table("profiles").update({"must_change_password": True}).eq("id", user_id).execute()
    audit_service.log("user.reset_password", actor_id=actor.id, entity="profile", entity_id=user_id, via=via, ip=ip)
    _queue_credentials_email("password_reset_by_admin", {**row, "must_change_password": True}, password)
    return get_user_detail(user_id)


def resend_credentials(actor: CurrentUser, user_id: str, *, via: Via = "ui", ip: str | None = None) -> UserDetail:
    """Re-send the welcome email. Passwords are never stored, so a fresh default
    password is generated. Only allowed while the user has not set their own
    password - otherwise it would silently replace a password they chose."""
    row = get_profile_row(user_id)
    if not row["must_change_password"]:
        raise AppError(
            "password_already_set",
            "This user has already set their own password. Use 'Reset password' if they are locked out.",
            status.HTTP_409_CONFLICT,
        )
    password = generate_default_password()
    service_client().auth.admin.update_user_by_id(user_id, {"password": password})
    audit_service.log("user.resend_credentials", actor_id=actor.id, entity="profile", entity_id=user_id, via=via, ip=ip)
    _queue_credentials_email(_welcome_template(row["role"]), row, password)
    return get_user_detail(user_id)


def notify_password_changed(row: dict[str, Any]) -> None:
    changed_at = datetime.now(timezone.utc).strftime("%d %B %Y at %H:%M UTC")
    email_service.queue_email(
        "password_changed", row["email"], {"full_name": row["full_name"], "changed_at": changed_at},
        related_user_id=row["id"],
    )
