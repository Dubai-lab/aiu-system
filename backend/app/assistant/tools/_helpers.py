"""Small helpers shared by the tool modules."""

from typing import Any

from pydantic import ValidationError

from app.assistant.registry import ToolError

ALL_ROLES = ("admin", "teacher", "student")


def obj(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    """JSON schema for a tool's input object."""
    return {"type": "object", "properties": properties, "required": required or [], "additionalProperties": False}


def s(description: str, **extra: Any) -> dict[str, Any]:
    return {"type": "string", "description": description, **extra}


def refresh(*keys: str) -> dict[str, Any]:
    """UI action: invalidate these TanStack Query key prefixes so pages show new data at once."""
    return {"type": "refresh", "keys": list(keys)}


def navigate(path: str) -> dict[str, Any]:
    return {"type": "navigate", "path": path}


def validation_message(exc: ValidationError) -> str:
    """First pydantic error as a sentence the assistant can say."""
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(p) for p in first.get("loc", []))
    msg = str(first.get("msg", "is not valid")).replace("Value error, ", "")
    return f"The {field.replace('_', ' ')} {msg}." if field else "Some details are not valid."


def validated(model: type, **data: Any):
    try:
        return model(**{k: v for k, v in data.items() if v is not None})
    except ValidationError as exc:
        raise ToolError(validation_message(exc)) from exc


def money(amount: float, currency: str = "USD") -> str:
    return f"{amount:,.2f} {currency}"
