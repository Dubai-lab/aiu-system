"""Audit log and email log (admin only)."""

from typing import Any, Literal

from fastapi import APIRouter, Query

from app.core.security import AdminDep
from app.services import log_service

router = APIRouter(tags=["logs"])
DATE = r"^\d{4}-\d{2}-\d{2}$"


@router.get("/audit-logs")
def audit_logs(
    _: AdminDep,
    action: str | None = Query(default=None, max_length=60),
    via: Literal["ui", "voice", "system"] | None = None,
    actor_id: str | None = None,
    date_from: str | None = Query(default=None, pattern=DATE),
    date_to: str | None = Query(default=None, pattern=DATE),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> dict[str, Any]:
    """Every create/update/delete, login and assistant action - filter by actor, action, via ui/voice, date."""
    result = log_service.list_audit_logs(action=action, via=via, actor_id=actor_id, date_from=date_from,
                                         date_to=date_to, page=page, page_size=page_size)
    result["counts_by_via"] = log_service.audit_counts_by_via()
    return result


@router.get("/email-logs")
def email_logs(
    _: AdminDep,
    status: Literal["sent", "failed"] | None = None,
    template: str | None = Query(default=None, max_length=40),
    search: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> dict[str, Any]:
    return log_service.list_email_logs(status=status, template=template, search=search, page=page, page_size=page_size)
