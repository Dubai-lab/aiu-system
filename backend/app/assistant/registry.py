"""Tool registry for the voice assistant (spec 13.4 / 13.5).

Every tool is defined ONCE with: name, description (written for the model), JSON
input schema, allowed roles, whether it needs confirmation, and a handler that
calls the SERVICE LAYER - the same functions the REST routes use - as the
logged-in user, with via="voice". The assistant therefore can never do more than
the user could do by clicking.

Sensitive tools (requires_confirmation=True) run in two steps:
  prepare(ctx, args) -> validates + resolves names to ids, returns (summary, stored_args)
  run(ctx, stored_args) -> executed only after the user confirms (button or "yes").
"""

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from app.core.errors import AppError
from app.core.security import CurrentUser
from app.db.supabase_client import service_client

logger = logging.getLogger(__name__)

PENDING_MINUTES = 5


class ToolError(Exception):
    """A user-facing problem with a tool call (bad name, missing info...)."""

    def __init__(self, message: str, options: list[str] | None = None):
        super().__init__(message)
        self.message = message
        self.options = options or []


@dataclass
class ToolContext:
    user: CurrentUser
    conversation_id: str
    ip: str | None = None
    current_path: str | None = None


@dataclass
class ToolOutcome:
    data: dict[str, Any]
    ui_actions: list[dict[str, Any]] = field(default_factory=list)
    pending_action: dict[str, Any] | None = None


Handler = Callable[[ToolContext, dict[str, Any]], ToolOutcome]
Preparer = Callable[[ToolContext, dict[str, Any]], tuple[str, dict[str, Any]]]


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    roles: tuple[str, ...]
    run: Handler
    requires_confirmation: bool = False
    prepare: Preparer | None = None

    def schema(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "input_schema": self.input_schema}


_TOOLS: dict[str, Tool] = {}


def register(tool: Tool) -> Tool:
    if tool.name in _TOOLS:
        raise ValueError(f"Duplicate tool {tool.name}")
    if tool.requires_confirmation and tool.prepare is None:
        raise ValueError(f"{tool.name} needs a prepare() step")
    _TOOLS[tool.name] = tool
    return tool


def all_tools() -> dict[str, Tool]:
    _load_tool_modules()
    return _TOOLS


def tools_for_role(role: str) -> list[Tool]:
    """Only the tools this role may use are ever sent to the model."""
    return [t for t in all_tools().values() if role in t.roles]


def tool_schemas_for_role(role: str) -> list[dict[str, Any]]:
    return [t.schema() for t in sorted(tools_for_role(role), key=lambda t: t.name)]  # stable order = cacheable


_loaded = False


def _load_tool_modules() -> None:
    global _loaded
    if not _loaded:
        _loaded = True
        from app.assistant.tools import admin, common, student, teacher  # noqa: F401 - registers tools


# --------------------------------------------------------------------------- execution

def _error(message: str, options: list[str] | None = None) -> ToolOutcome:
    data: dict[str, Any] = {"ok": False, "error": message}
    if options:
        data["valid_options"] = options
    return ToolOutcome(data=data)


def execute(name: str, args: dict[str, Any], ctx: ToolContext) -> ToolOutcome:
    """Run one tool call for the model. Never raises: problems come back as
    {"ok": false, "error": "..."} so the assistant can explain them."""
    tool = all_tools().get(name)
    if tool is None or ctx.user.role not in tool.roles:
        return _error("That action is not available for your role.")
    try:
        if tool.requires_confirmation:
            summary, stored = tool.prepare(ctx, args or {})  # type: ignore[misc]
            pending = store_pending_action(ctx, tool.name, stored, summary)
            return ToolOutcome(
                data={"status": "confirmation_required", "summary": summary,
                      "instruction": "Tell the user exactly what will happen and ask them to confirm. "
                                     "Do not say it is done."},
                pending_action={"id": pending["id"], "summary": summary},
            )
        return tool.run(ctx, args or {})
    except ToolError as exc:
        return _error(exc.message, exc.options)
    except AppError as exc:
        return _error(exc.message)
    except Exception:  # noqa: BLE001 - never leak a raw exception to the model
        logger.exception("Assistant tool %s failed", name)
        return _error("Something went wrong while doing that. Please try again or use the menus.")


# --------------------------------------------------------------------------- pending actions

def store_pending_action(ctx: ToolContext, tool_name: str, args: dict[str, Any], summary: str) -> dict[str, Any]:
    """One pending action per conversation: a new sensitive request replaces the old one."""
    db = service_client()
    now = datetime.now(timezone.utc)
    db.table("assistant_pending_actions").update({"status": "cancelled", "resolved_at": now.isoformat()}) \
        .eq("conversation_id", ctx.conversation_id).eq("status", "pending").execute()
    return db.table("assistant_pending_actions").insert({
        "conversation_id": ctx.conversation_id, "user_id": ctx.user.id, "tool_name": tool_name,
        "arguments": json.loads(json.dumps(args, default=str)), "summary": summary,
        "expires_at": (now + timedelta(minutes=PENDING_MINUTES)).isoformat(),
    }).execute().data[0]


def latest_pending(ctx: ToolContext) -> dict[str, Any] | None:
    rows = service_client().table("assistant_pending_actions").select("*") \
        .eq("conversation_id", ctx.conversation_id).eq("user_id", ctx.user.id).eq("status", "pending") \
        .order("created_at", desc=True).limit(1).execute().data
    return rows[0] if rows else None


def resolve_pending(ctx: ToolContext, pending_id: str | None, decision: str) -> ToolOutcome:
    """Confirm or cancel a pending action (from the Confirm/Cancel buttons or by voice).
    Expired, cancelled or someone else's actions can never be executed."""
    db = service_client()
    q = db.table("assistant_pending_actions").select("*").eq("conversation_id", ctx.conversation_id) \
        .eq("user_id", ctx.user.id)
    rows = (q.eq("id", pending_id) if pending_id else q.eq("status", "pending").order("created_at", desc=True)) \
        .limit(1).execute().data
    if not rows or rows[0]["status"] != "pending":
        return _error("There is no action waiting for confirmation.")
    pending = rows[0]
    now = datetime.now(timezone.utc)
    if datetime.fromisoformat(pending["expires_at"]) < now:
        db.table("assistant_pending_actions").update({"status": "expired", "resolved_at": now.isoformat()}) \
            .eq("id", pending["id"]).execute()
        return _error("That request expired (confirmations are valid for 5 minutes). Please ask again.")

    # Claim it atomically: only one confirm can move it out of "pending".
    new_status = "confirmed" if decision == "confirm" else "cancelled"
    claimed = db.table("assistant_pending_actions").update({"status": new_status, "resolved_at": now.isoformat()}) \
        .eq("id", pending["id"]).eq("status", "pending").execute().data
    if not claimed:
        return _error("There is no action waiting for confirmation.")
    if decision != "confirm":
        return ToolOutcome(data={"ok": True, "cancelled": True, "summary": pending["summary"]})

    tool = all_tools().get(pending["tool_name"])
    if tool is None or ctx.user.role not in tool.roles:
        return _error("That action is not available for your role.")
    try:
        return tool.run(ctx, pending["arguments"])
    except ToolError as exc:
        return _error(exc.message, exc.options)
    except AppError as exc:
        return _error(exc.message)
    except Exception:  # noqa: BLE001
        logger.exception("Confirmed assistant action %s failed", tool.name)
        return _error("Something went wrong while doing that. Please try again or use the menus.")
