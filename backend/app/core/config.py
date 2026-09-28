"""Application settings, loaded once from environment variables / backend/.env."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Supabase
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: SecretStr

    # Claude (voice assistant)
    ANTHROPIC_API_KEY: SecretStr = SecretStr("")
    ANTHROPIC_MODEL: str = "claude-haiku-4-5"
    ANTHROPIC_MAX_TOKENS: int = 1024
    ANTHROPIC_MAX_TOOL_ROUNDS: int = 6
    ANTHROPIC_TIMEOUT_SECONDS: float = 30.0

    # Face service + thresholds
    FACE_SERVICE_URL: str = "http://127.0.0.1:8001"
    FACE_SERVICE_KEY: SecretStr
    FACE_MATCH_THRESHOLD: float = Field(0.45, ge=0, le=1)
    FACE_MATCH_MARGIN: float = Field(0.05, ge=0, le=1)
    FACE_VERIFY_THRESHOLD: float = Field(0.45, ge=0, le=1)
    FACE_SERVICE_TIMEOUT_SECONDS: float = 30.0

    # Face quality rules (spec 10.3) - starting values, tune during testing.
    FACE_MIN_DET_SCORE: float = 0.60
    FACE_MIN_WIDTH_PX: float = 110
    FACE_MIN_BLUR: float = 60           # Laplacian variance of the face crop
    FACE_MAX_FRONTAL_YAW: float = 12    # "look straight" frames
    FACE_MAX_FRONTAL_PITCH: float = 15
    FACE_MAX_TURN_YAW: float = 40       # "slight turn" enrollment frames must not be extreme
    FACE_MAX_TURN_PITCH: float = 35
    FACE_SAME_PERSON_MIN: float = 0.50  # every frame must match the others (one person)

    # Liveness (spec 8.3): the "turn" photo must be turned at least this far in the
    # requested direction. FACE_YAW_LEFT_SIGN maps "user turns LEFT" to the sign of
    # the yaw reported for the un-mirrored frame (+1 measured on this project's webcam).
    FACE_LIVENESS_MIN_TURN_YAW: float = 18
    FACE_LIVENESS_SAME_PERSON: float = 0.50
    FACE_YAW_LEFT_SIGN: Literal[1, -1] = 1

    # Attendance: students below this percentage are highlighted in reports.
    ATTENDANCE_LOW_THRESHOLD: float = Field(75, ge=0, le=100)

    # Email
    EMAIL_MODE: Literal["smtp", "console"] = "console"
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: SecretStr = SecretStr("")
    EMAIL_FROM_NAME: str = "AIU Administration"
    EMAIL_FROM_ADDRESS: str = ""

    # App
    APP_BASE_URL: str = "http://localhost:5173"
    CORS_ORIGINS: str = "http://localhost:5173"  # comma-separated
    FORCE_PASSWORD_CHANGE_ON_FIRST_LOGIN: bool = False
    UNIVERSITY_NAME: str = "AIU"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
