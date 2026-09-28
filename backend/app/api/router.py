"""All /api/v1 routes."""

from fastapi import APIRouter

from app.api.routes import academics, assistant, attendance, auth, face, finance, logs, users

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(academics.router)
api_router.include_router(face.router)
api_router.include_router(attendance.router)
api_router.include_router(finance.router)
api_router.include_router(assistant.router)
api_router.include_router(logs.router)
