"""Public authentication routes."""

from fastapi import APIRouter, Request

from app.core.security import client_ip
from app.schemas.auth import LoginRequest, LoginResponse
from app.schemas.face import ChallengeOut, FaceLoginRequest, FaceLoginResponse
from app.services import auth_service, face_auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, request: Request) -> LoginResponse:
    """Password login with a registration number (students) or email (staff)."""
    return auth_service.login(body.identifier, body.password, client_ip(request))


@router.post("/face/challenge", response_model=ChallengeOut)
def face_challenge(request: Request) -> ChallengeOut:
    """Start a face login: returns the liveness steps (look straight, then turn left/right)."""
    return face_auth_service.create_challenge("login", ip=client_ip(request))


@router.post("/face/login", response_model=FaceLoginResponse)
def face_login(body: FaceLoginRequest, request: Request) -> FaceLoginResponse:
    """Face login. Returns a single-use token_hash for supabase.auth.verifyOtp."""
    return face_auth_service.face_login(body.challenge_id, body.frames, client_ip(request))
