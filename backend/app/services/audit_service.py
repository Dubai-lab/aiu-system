"""Audit log writer. Every service that changes data (and every login) calls log()."""

import logging
from typing import Any, Literal

from app.core.background import run_in_background
from app.db.supabase_client import service_client

logger = logging.getLogger(__name__)

Via = Literal["ui", "voice", "system"]


def _write(row: dict[str, Any]) -> None:
    service_client().table("audit_logs").insert(row).execute()


def log(
    action: str,
    *,
    actor_id: str | None,
    entity: str | None = None,
    entity_id: str | None = None,
    details: dict[str, Any] | None = None,
    via: Via = "ui",
    ip: str | None = None,
) -> None:
    """Queue one audit entry. Never raises and never delays the response;
    a failed write is logged on the server."""
    run_in_background(
        _write,
        {
            "actor_id": actor_id,
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "details": details or {},
            "via": via,
            "ip": ip,
        },
    )
