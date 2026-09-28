"""Assistant engine (spec 13.1 / 13.3 / 13.8).

handle_message(): load the user's conversation (last 20 messages), give Claude the
tools for THIS user's role, run the tool calls through the service layer (max 6
rounds), save everything, and return the reply + UI actions + any pending
confirmation. If the Claude API fails, the user gets a friendly message and the
rest of the system keeps working.
"""

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any

import anthropic

from app.assistant import registry
from app.assistant.prompts import build_system
from app.assistant.registry import ToolContext
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import CurrentUser
from app.db.supabase_client import service_client
from app.services import rate_limit_service
from app.services.user_service import is_valid_uuid

logger = logging.getLogger(__name__)

HISTORY_LIMIT = 20
RATE_BUCKET = "assistant"
RATE_LIMIT = 30              # messages per user ...
RATE_WINDOW = 600            # ... per 10 minutes
UNAVAILABLE = "Sorry, the assistant is unavailable right now - you can still use the menus."
BUTTON_PREFIX = "[Button]"


@dataclass
class AssistantReply:
    conversation_id: str
    reply: str
    actions: list[dict[str, Any]] = field(default_factory=list)
    pending_action: dict[str, Any] | None = None


@lru_cache
def get_client() -> anthropic.Anthropic:
    s = get_settings()
    return anthropic.Anthropic(api_key=s.ANTHROPIC_API_KEY.get_secret_value(),
                               timeout=s.ANTHROPIC_TIMEOUT_SECONDS, max_retries=1)


# --------------------------------------------------------------------------- conversations

def _get_or_create_conversation(user: CurrentUser, conversation_id: str | None, first_text: str) -> str:
    db = service_client()
    if conversation_id and is_valid_uuid(conversation_id):
        found = db.table("assistant_conversations").select("id").eq("id", conversation_id).eq("user_id", user.id) \
            .limit(1).execute().data
        if found:
            db.table("assistant_conversations").update({"updated_at": datetime.now(timezone.utc).isoformat()}) \
                .eq("id", conversation_id).execute()
            return conversation_id
    title = " ".join(first_text.split())[:80] or "Conversation"
    return db.table("assistant_conversations").insert({"user_id": user.id, "title": title}).execute().data[0]["id"]


def _is_tool_result_turn(content: Any) -> bool:
    return isinstance(content, list) and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content)


def load_history(conversation_id: str) -> list[dict[str, Any]]:
    """Last HISTORY_LIMIT messages, trimmed so the history starts with a plain user
    message (never an orphaned tool_result, which the API would reject)."""
    rows = service_client().table("assistant_messages").select("role, content").eq("conversation_id", conversation_id) \
        .order("created_at", desc=True).limit(HISTORY_LIMIT).execute().data
    rows.reverse()
    while rows and (rows[0]["role"] != "user" or _is_tool_result_turn(rows[0]["content"])):
        rows.pop(0)
    return [{"role": r["role"], "content": r["content"]} for r in rows]


def _save(conversation_id: str, messages: list[dict[str, Any]]) -> None:
    if not messages:
        return
    base = datetime.now(timezone.utc)
    service_client().table("assistant_messages").insert([
        {"conversation_id": conversation_id, "role": m["role"], "content": m["content"],
         # explicit, strictly increasing timestamps keep the order even for a batch insert
         "created_at": (base + timedelta(microseconds=i)).isoformat()}
        for i, m in enumerate(messages)
    ]).execute()


def _serialize(content: list[Any]) -> list[dict[str, Any]]:
    """Response blocks -> plain API-shaped dicts (stored as JSON, sent back next turn)."""
    out = []
    for b in content:
        if b.type == "text":
            out.append({"type": "text", "text": b.text})
        elif b.type == "tool_use":
            out.append({"type": "tool_use", "id": b.id, "name": b.name, "input": b.input})
    return out or [{"type": "text", "text": ""}]


def _text_of(content: list[dict[str, Any]]) -> str:
    return " ".join(b["text"] for b in content if b.get("type") == "text" and b.get("text")).strip()


# --------------------------------------------------------------------------- the loop

def _run_turn(user: CurrentUser, conversation_id: str, user_text: str, current_path: str | None,
              ip: str | None, extra_actions: list[dict[str, Any]] | None = None) -> AssistantReply:
    s = get_settings()
    ctx = ToolContext(user=user, conversation_id=conversation_id, ip=ip, current_path=current_path)
    tools = registry.tool_schemas_for_role(user.role)
    system = build_system(user, current_path)
    messages = load_history(conversation_id) + [{"role": "user", "content": [{"type": "text", "text": user_text}]}]
    new_messages: list[dict[str, Any]] = [messages[-1]]
    actions: list[dict[str, Any]] = list(extra_actions or [])
    pending: dict[str, Any] | None = None
    reply = ""

    try:
        for round_no in range(s.ANTHROPIC_MAX_TOOL_ROUNDS + 1):
            last_round = round_no == s.ANTHROPIC_MAX_TOOL_ROUNDS
            response = get_client().messages.create(
                model=s.ANTHROPIC_MODEL,
                max_tokens=s.ANTHROPIC_MAX_TOKENS,
                system=system,
                tools=tools,
                # after the maximum number of tool rounds, force a spoken answer
                **({"tool_choice": {"type": "none"}} if last_round else {}),
                messages=messages,
            )
            usage = response.usage
            logger.info("assistant round %s: stop=%s in=%s out=%s cache_read=%s cache_write=%s", round_no,
                        response.stop_reason, getattr(usage, "input_tokens", None), getattr(usage, "output_tokens", None),
                        getattr(usage, "cache_read_input_tokens", None), getattr(usage, "cache_creation_input_tokens", None))
            content = _serialize(response.content)
            assistant_msg = {"role": "assistant", "content": content}
            messages.append(assistant_msg)
            new_messages.append(assistant_msg)
            if response.stop_reason == "refusal":
                reply = "Sorry, I can't help with that."
                break
            if response.stop_reason != "tool_use":
                reply = _text_of(content)
                break
            results = []
            for block in content:
                if block["type"] != "tool_use":
                    continue
                outcome = registry.execute(block["name"], block["input"], ctx)
                actions += outcome.ui_actions
                pending = outcome.pending_action or pending
                results.append({"type": "tool_result", "tool_use_id": block["id"],
                                "content": json.dumps(outcome.data, default=str),
                                **({"is_error": True} if outcome.data.get("ok") is False else {})})
            tool_msg = {"role": "user", "content": results}
            messages.append(tool_msg)
            new_messages.append(tool_msg)
    except anthropic.APIError as exc:
        logger.error("Claude API error in assistant: %s", exc)
        reply = UNAVAILABLE
        new_messages.append({"role": "assistant", "content": [{"type": "text", "text": UNAVAILABLE}]})

    # A pending action that was confirmed/cancelled later in this same turn is no longer pending.
    if pending and registry.latest_pending(ctx) is None:
        pending = None
    _save(conversation_id, new_messages)
    return AssistantReply(conversation_id=conversation_id, reply=reply or "Done.", actions=actions, pending_action=pending)


def handle_message(user: CurrentUser, conversation_id: str | None, text: str, current_path: str | None,
                   ip: str | None = None) -> AssistantReply:
    text = " ".join((text or "").split())
    if not text:
        raise AppError("empty_message", "Say or type something first.")
    if len(text) > 2000:
        raise AppError("message_too_long", "That message is too long. Please keep it under 2,000 characters.")
    rate_limit_service.ensure_allowed(RATE_BUCKET, user.id, limit=RATE_LIMIT, window_seconds=RATE_WINDOW,
                                      message="You've sent a lot of messages. Please wait a few minutes and try again.")
    rate_limit_service.record(RATE_BUCKET, user.id)
    convo = _get_or_create_conversation(user, conversation_id, text)
    return _run_turn(user, convo, text, current_path, ip)


def confirm(user: CurrentUser, pending_action_id: str, decision: str, current_path: str | None,
            ip: str | None = None) -> AssistantReply:
    """Confirm/Cancel button: run (or drop) the stored action, then let Claude reply naturally."""
    if not is_valid_uuid(pending_action_id):
        raise AppError("not_found", "That confirmation was not found.", 404)
    row = service_client().table("assistant_pending_actions").select("conversation_id, summary") \
        .eq("id", pending_action_id).eq("user_id", user.id).maybe_single().execute()
    if not row or not row.data:
        raise AppError("not_found", "That confirmation was not found.", 404)
    convo = row.data["conversation_id"]
    ctx = ToolContext(user=user, conversation_id=convo, ip=ip, current_path=current_path)
    outcome = registry.resolve_pending(ctx, pending_action_id, decision)
    pressed = "Confirm" if decision == "confirm" else "Cancel"
    note = (f"{BUTTON_PREFIX} The user pressed {pressed} for: {row.data['summary']} "
            f"Result: {json.dumps(outcome.data, default=str)}")
    return _run_turn(user, convo, note, current_path, ip, extra_actions=outcome.ui_actions)


# --------------------------------------------------------------------------- history for the panel

def list_conversations(user: CurrentUser) -> list[dict[str, Any]]:
    return service_client().table("assistant_conversations").select("id, title, created_at, updated_at") \
        .eq("user_id", user.id).order("updated_at", desc=True).limit(20).execute().data


def conversation_messages(user: CurrentUser, conversation_id: str) -> list[dict[str, str]]:
    """Only what the user should see: their words and the assistant's spoken replies."""
    if not is_valid_uuid(conversation_id):
        raise AppError("not_found", "Conversation not found.", 404)
    owned = service_client().table("assistant_conversations").select("id").eq("id", conversation_id) \
        .eq("user_id", user.id).limit(1).execute().data
    if not owned:
        raise AppError("not_found", "Conversation not found.", 404)
    rows = service_client().table("assistant_messages").select("role, content, created_at") \
        .eq("conversation_id", conversation_id).order("created_at").execute().data
    out = []
    for r in rows:
        if _is_tool_result_turn(r["content"]):
            continue
        text = _text_of(r["content"]) if isinstance(r["content"], list) else str(r["content"])
        if text and not text.startswith(BUTTON_PREFIX):
            out.append({"role": r["role"], "text": text, "created_at": r["created_at"]})
    return out


def delete_conversation(user: CurrentUser, conversation_id: str) -> None:
    if not is_valid_uuid(conversation_id):
        raise AppError("not_found", "Conversation not found.", 404)
    service_client().table("assistant_conversations").delete().eq("id", conversation_id).eq("user_id", user.id).execute()
