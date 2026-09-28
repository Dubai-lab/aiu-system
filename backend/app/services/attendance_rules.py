"""Pure attendance rules (no I/O) so they can be unit-tested."""

import secrets
from datetime import datetime
from typing import Any


def new_class_code() -> str:
    """Random 6-digit code (leading zeros allowed), from a cryptographic RNG."""
    return f"{secrets.randbelow(1_000_000):06d}"


def counts_for_student(sessions: list[dict[str, Any]], enrolled_at: datetime | None,
                       marked_session_ids: set[str]) -> tuple[int, int]:
    """(attended, total) for one student in one course.

    A session counts towards the total when the student was marked in it, or when it
    is CLOSED and started after the student enrolled. So a student enrolled late is
    not marked absent for earlier sessions, and a session still in progress does not
    count against anyone until it ends.
    """
    attended = total = 0
    for s in sessions:
        marked = s["id"] in marked_session_ids
        opened = s["opens_at"] if isinstance(s["opens_at"], datetime) else datetime.fromisoformat(s["opens_at"])
        eligible = marked or (s["status"] == "closed" and (enrolled_at is None or opened >= enrolled_at))
        if eligible:
            total += 1
            attended += int(marked)
    return attended, total


def percent(attended: int, total: int) -> float | None:
    return round(100.0 * attended / total, 1) if total else None


def is_low(pct: float | None, threshold: float) -> bool:
    return pct is not None and pct < threshold
