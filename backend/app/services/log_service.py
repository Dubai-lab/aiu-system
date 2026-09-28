"""Read-only views of the audit log and the email log for admins (spec 14.1 / 15)."""

from datetime import date, timedelta
from typing import Any

from app.db.supabase_client import service_client
from app.services.user_service import is_valid_uuid


def _page(page: int, page_size: int) -> tuple[int, int, int]:
    page, page_size = max(1, page), min(max(1, page_size), 100)
    return page, page_size, (page - 1) * page_size


def _day_after(d: str) -> str:
    return (date.fromisoformat(d) + timedelta(days=1)).isoformat()


def list_audit_logs(*, action: str | None = None, via: str | None = None, actor_id: str | None = None,
                    date_from: str | None = None, date_to: str | None = None,
                    page: int = 1, page_size: int = 50) -> dict[str, Any]:
    page, page_size, start = _page(page, page_size)
    q = service_client().table("audit_logs").select(
        "id, action, entity, entity_id, details, via, ip, created_at, actor:profiles(id, full_name, role)", count="exact")
    if action:
        safe = "".join(ch for ch in action if ch.isalnum() or ch in "._")
        q = q.ilike("action", f"*{safe}*")
    if via in ("ui", "voice", "system"):
        q = q.eq("via", via)
    if actor_id and is_valid_uuid(actor_id):
        q = q.eq("actor_id", actor_id)
    if date_from:
        q = q.gte("created_at", date_from)
    if date_to:
        q = q.lt("created_at", _day_after(date_to))  # inclusive end date
    r = q.order("created_at", desc=True).range(start, start + page_size - 1).execute()
    return {"items": r.data, "total": r.count or 0, "page": page, "page_size": page_size}


def audit_counts_by_via() -> dict[str, int]:
    """How many actions were done by voice vs by clicking (shown on the audit page)."""
    db = service_client()
    return {v: db.table("audit_logs").select("id", count="exact").eq("via", v).limit(1).execute().count or 0
            for v in ("ui", "voice", "system")}


def list_email_logs(*, status: str | None = None, template: str | None = None, search: str | None = None,
                    page: int = 1, page_size: int = 50) -> dict[str, Any]:
    page, page_size, start = _page(page, page_size)
    q = service_client().table("email_logs").select(
        "id, to_email, template, subject, status, error, created_at, related_user_id,"
        " user:profiles(id, full_name, must_change_password)", count="exact")
    if status in ("sent", "failed"):
        q = q.eq("status", status)
    if template:
        q = q.eq("template", template)
    if search:
        safe = "".join(ch for ch in search if ch.isalnum() or ch in "@._-+")
        q = q.ilike("to_email", f"*{safe}*")
    r = q.order("created_at", desc=True).range(start, start + page_size - 1).execute()
    return {"items": r.data, "total": r.count or 0, "page": page, "page_size": page_size}
