"""Voice assistant API (spec 13 + section 15). Available to every logged-in user;
the assistant only receives the tools of the caller's role."""

from typing import Any, Literal

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel, Field

from app.assistant import engine
from app.core.security import CurrentUserDep, client_ip
from app.services import dashboard_service

router = APIRouter(tags=["assistant"])


class MessageRequest(BaseModel):
    conversation_id: str | None = None
    message: str = Field(min_length=1, max_length=2000)
    current_path: str | None = Field(default=None, max_length=300)


class ConfirmRequest(BaseModel):
    pending_action_id: str
    decision: Literal["confirm", "cancel"]
    current_path: str | None = Field(default=None, max_length=300)


class PendingOut(BaseModel):
    id: str
    summary: str


class ReplyOut(BaseModel):
    conversation_id: str
    reply: str
    actions: list[dict[str, Any]]
    pending_action: PendingOut | None = None


def _out(r: engine.AssistantReply) -> ReplyOut:
    return ReplyOut(conversation_id=r.conversation_id, reply=r.reply, actions=r.actions,
                    pending_action=PendingOut(**r.pending_action) if r.pending_action else None)


@router.post("/assistant/message", response_model=ReplyOut)
def assistant_message(body: MessageRequest, user: CurrentUserDep, request: Request) -> ReplyOut:
    return _out(engine.handle_message(user, body.conversation_id, body.message, body.current_path, client_ip(request)))


@router.post("/assistant/confirm", response_model=ReplyOut)
def assistant_confirm(body: ConfirmRequest, user: CurrentUserDep, request: Request) -> ReplyOut:
    return _out(engine.confirm(user, body.pending_action_id, body.decision, body.current_path, client_ip(request)))


@router.get("/assistant/conversations")
def conversations(user: CurrentUserDep) -> list[dict[str, Any]]:
    return engine.list_conversations(user)


@router.get("/assistant/conversations/{conversation_id}")
def conversation(conversation_id: str, user: CurrentUserDep) -> list[dict[str, str]]:
    return engine.conversation_messages(user, conversation_id)


@router.delete("/assistant/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(conversation_id: str, user: CurrentUserDep) -> Response:
    engine.delete_conversation(user, conversation_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/dashboard")
def dashboard(user: CurrentUserDep) -> dict[str, Any]:
    """Role-specific dashboard numbers (the same data the assistant uses)."""
    return dashboard_service.get_dashboard(user)
