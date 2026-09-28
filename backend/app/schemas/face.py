"""Request/response models for face enrollment."""

from pydantic import BaseModel, Field

from app.schemas.auth import ProfileOut

# A 640 px JPEG at quality 0.85 is ~40-120 KB; 1 MB of image = ~1.4 MB of base64.
MAX_IMAGE_B64 = 1_400_000


class FrameIn(BaseModel):
    step: str = Field(max_length=32)
    image: str = Field(min_length=100, max_length=MAX_IMAGE_B64, description="base64 JPEG (data URL allowed)")


class EnrollRequest(BaseModel):
    consent: bool
    frames: list[FrameIn] = Field(min_length=5, max_length=5)


class ChallengeOut(BaseModel):
    challenge_id: str
    steps: list[str]
    expires_in: int


class FaceLoginRequest(BaseModel):
    challenge_id: str = Field(max_length=64)
    frames: list[FrameIn] = Field(min_length=2, max_length=2)


class FaceLoginResponse(BaseModel):
    token_hash: str
    profile: ProfileOut


class FaceServiceStatus(BaseModel):
    status: str
    model_loaded: bool
