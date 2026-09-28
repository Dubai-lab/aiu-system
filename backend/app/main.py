"""AIU main backend (FastAPI, port 8000).

Routes live in app/api/routes and are mounted under /api/v1. All business logic
lives in app/services so REST endpoints and assistant tools share one code path.
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.background import run_in_background
from app.core.errors import register_error_handlers
from app.core.security import prefetch_signing_keys
from app.db.supabase_client import service_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)  # do not log every Supabase URL

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Warm up without blocking start-up: signing keys + the Supabase connection.
    run_in_background(prefetch_signing_keys)
    run_in_background(lambda: service_client().table("departments").select("id").limit(1).execute())
    yield


app = FastAPI(
    lifespan=lifespan,
    title=f"{settings.UNIVERSITY_NAME} Voice Assistance and Face ID Management System",
    version="1.0.0",
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,  # only the frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_error_handlers(app)
app.include_router(api_router)


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    """Liveness plus a database check (confirms the migrations have been applied)."""
    database = "ok"
    try:
        service_client().table("departments").select("id", count="exact").limit(1).execute()
    except Exception as exc:  # noqa: BLE001 - report any failure as a status string
        database = f"error: {exc.__class__.__name__}"
    return {"status": "ok", "database": database}
