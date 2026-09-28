"""The shared page registry (shared/pages.json) - the same file the frontend router
is built from, so the assistant can only ever open pages that really exist."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

PAGES_FILE = Path(__file__).resolve().parents[3] / "shared" / "pages.json"


@lru_cache
def load_pages() -> list[dict[str, Any]]:
    return json.loads(PAGES_FILE.read_text(encoding="utf-8"))


def pages_for_role(role: str) -> list[dict[str, Any]]:
    return [p for p in load_pages() if role in p["roles"]]


def page_by_key(key: str) -> dict[str, Any] | None:
    return next((p for p in load_pages() if p["key"] == key), None)


def fill_path(page: dict[str, Any], params: dict[str, str] | None = None) -> str:
    path = page["path"]
    for name in page.get("requires_params", []):
        value = (params or {}).get(name)
        if not value:
            raise KeyError(name)
        path = path.replace(f":{name}", str(value))
    return path
