"""Face service settings (face-service/.env)."""

from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    FACE_SERVICE_KEY: SecretStr   # shared secret with the main backend
    MODEL_NAME: str = "buffalo_l"
    DET_SIZE: int = 640
    CTX_ID: int = -1              # -1 = CPU, 0 = first GPU
    MAX_IMAGES: int = 6
    MAX_IMAGE_BYTES: int = 1_000_000


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
