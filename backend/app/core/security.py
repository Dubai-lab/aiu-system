"""Authentication and role dependencies.

Every protected route depends on get_current_user, which:
  1. reads the "Authorization: Bearer <access_token>" header,
  2. verifies the Supabase JWT (asymmetric keys are verified locally against the
     project's published JWKS; legacy HS256 tokens are checked with Supabase Auth),
  3. loads the user's profile (the role stored there is the source of truth),
  4. rejects unknown or deactivated users.
require_roles(...) then restricts a route to specific roles.
"""

import hashlib
import logging
import threading
import time
from dataclasses import dataclass
from typing import Annotated, Any, Callable

import jwt
from fastapi import Depends, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings
from app.core.errors import AppError
from app.db.supabase_client import service_client
from app.db.selects import PROFILE_SELECT

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)
_ASYMMETRIC_ALGS = {"ES256", "RS256", "EdDSA"}

_settings = get_settings()
_ISSUER = f"{_settings.SUPABASE_URL.rstrip('/')}/auth/v1"
# Keys are cached for 6 h; an unknown key id (after a rotation) triggers an automatic refetch.
_jwks_client = jwt.PyJWKClient(f"{_ISSUER}/.well-known/jwks.json", cache_keys=True, lifespan=6 * 3600)


def prefetch_signing_keys() -> None:
    """Download the JWKS at startup so the first request does not pay for it."""
    try:
        _jwks_client.get_signing_keys()
    except Exception:  # noqa: BLE001 - legacy projects may publish no asymmetric keys
        logger.warning("Could not prefetch Supabase signing keys", exc_info=True)

# Short cache for the legacy HS256 path so we don't call Supabase on every request.
_legacy_cache: dict[str, tuple[float, str]] = {}
_legacy_lock = threading.Lock()
_LEGACY_TTL_SECONDS = 60


@dataclass(frozen=True)
class CurrentUser:
    """The authenticated caller. `profile` is the full profiles row."""

    id: str
    role: str
    email: str
    full_name: str
    profile: dict[str, Any]
    access_token: str


def _unauthorized(code: str, message: str) -> AppError:
    return AppError(code, message, status.HTTP_401_UNAUTHORIZED)


def verify_access_token(token: str) -> str:
    """Return the user id (sub) of a valid Supabase access token, or raise 401."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise _unauthorized("invalid_token", "Your session is invalid. Please log in again.") from exc

    alg = header.get("alg", "")
    if alg in _ASYMMETRIC_ALGS:
        try:
            signing_key = _jwks_client.get_signing_key_from_jwt(token).key
            claims = jwt.decode(
                token,
                signing_key,
                algorithms=[alg],
                audience="authenticated",
                issuer=_ISSUER,
                leeway=60,  # tolerate small clock differences between this server and Supabase
                options={"require": ["exp", "sub"]},
            )
        except jwt.ExpiredSignatureError as exc:
            raise _unauthorized("token_expired", "Your session has expired. Please log in again.") from exc
        except jwt.PyJWTError as exc:
            raise _unauthorized("invalid_token", "Your session is invalid. Please log in again.") from exc
        return str(claims["sub"])

    # Legacy symmetric (HS256) tokens: ask Supabase Auth, with a short cache.
    cache_key = hashlib.sha256(token.encode()).hexdigest()
    now = time.monotonic()
    with _legacy_lock:
        cached = _legacy_cache.get(cache_key)
        if cached and cached[0] > now:
            return cached[1]
    try:
        response = service_client().auth.get_user(token)
    except Exception as exc:  # noqa: BLE001 - any failure means the token is not usable
        raise _unauthorized("invalid_token", "Your session is invalid. Please log in again.") from exc
    if not response or not response.user:
        raise _unauthorized("invalid_token", "Your session is invalid. Please log in again.")
    with _legacy_lock:
        _legacy_cache[cache_key] = (now + _LEGACY_TTL_SECONDS, response.user.id)
    return response.user.id


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> CurrentUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized("not_authenticated", "Please log in to continue.")

    user_id = verify_access_token(credentials.credentials)
    # Profile + department in one round trip; /me reuses it instead of querying again.
    result = (
        service_client()
        .table("profiles")
        .select(PROFILE_SELECT)
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    profile = result.data if result else None
    if not profile:
        raise _unauthorized("no_profile", "No account is linked to this login.")
    if not profile["is_active"]:
        raise AppError("account_inactive", "Your account has been deactivated. Please contact the administrator.",
                       status.HTTP_403_FORBIDDEN)

    return CurrentUser(
        id=profile["id"],
        role=profile["role"],
        email=profile["email"],
        full_name=profile["full_name"],
        profile=profile,
        access_token=credentials.credentials,
    )


def require_roles(*roles: str) -> Callable[..., CurrentUser]:
    """Dependency factory: allow only the given roles."""

    def dependency(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
        if user.role not in roles:
            raise AppError("forbidden", "You are not allowed to do this.", status.HTTP_403_FORBIDDEN)
        return user

    return dependency


# Ready-made dependencies for routes.
CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]
AdminDep = Annotated[CurrentUser, Depends(require_roles("admin"))]
TeacherDep = Annotated[CurrentUser, Depends(require_roles("teacher"))]
StudentDep = Annotated[CurrentUser, Depends(require_roles("student"))]


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"
