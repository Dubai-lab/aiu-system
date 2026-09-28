"""Database-backed rate limiting (survives backend restarts).

Usage:
    rate_limit_service.ensure_allowed("login", key, limit=5, window_seconds=600)
    ... on failure: rate_limit_service.record("login", key)
    ... on success: rate_limit_service.clear("login", key)
"""

from datetime import datetime, timedelta, timezone

from fastapi import status

from app.core.background import run_in_background
from app.core.errors import AppError
from app.db.supabase_client import service_client


def _since(window_seconds: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=window_seconds)).isoformat()


def count_recent(bucket: str, key: str, window_seconds: int) -> int:
    result = (
        service_client()
        .table("rate_limit_hits")
        .select("id", count="exact")
        .eq("bucket", bucket)
        .eq("key", key)
        .gte("created_at", _since(window_seconds))
        .limit(1)
        .execute()
    )
    return result.count or 0


def ensure_allowed(bucket: str, key: str, *, limit: int, window_seconds: int, message: str | None = None) -> None:
    """Raise HTTP 429 when `key` already has `limit` hits in the window."""
    if count_recent(bucket, key, window_seconds) >= limit:
        minutes = max(1, window_seconds // 60)
        raise AppError(
            "rate_limited",
            message or f"Too many attempts. Please wait {minutes} minutes and try again.",
            status.HTTP_429_TOO_MANY_REQUESTS,
        )


def record(bucket: str, key: str) -> None:
    service_client().table("rate_limit_hits").insert({"bucket": bucket, "key": key}).execute()


def _delete(bucket: str, key: str) -> None:
    service_client().table("rate_limit_hits").delete().eq("bucket", bucket).eq("key", key).execute()


def clear(bucket: str, key: str) -> None:
    """Forget past failures after a success (runs in the background)."""
    run_in_background(_delete, bucket, key)
