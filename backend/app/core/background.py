"""Fire-and-forget work (audit writes, cleanup) that must not slow down a response.

Each Supabase round trip costs ~0.5 s from the client's network, so side effects
the user does not need to wait for run on a small thread pool instead.
"""

import atexit
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="aiu-bg")
atexit.register(_executor.shutdown, wait=True)  # finish queued writes on shutdown


def run_in_background(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
    def _safe() -> None:
        try:
            fn(*args, **kwargs)
        except Exception:  # noqa: BLE001
            logger.exception("Background task %s failed", getattr(fn, "__name__", fn))

    _executor.submit(_safe)
