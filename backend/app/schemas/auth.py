"""Request/response models for login, the current user and password changes."""

import re
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator


class DepartmentRef(BaseModel):
    id: str
    name: str
    code: str


class ProfileOut(BaseModel):
    """What the browser is allowed to know about the logged-in user."""

    id: str
    role: str
    full_name: str
    email: str
    reg_number: str | None = None
    staff_title: str | None = None
    department: DepartmentRef | None = None
    level: int | None = None
    intake_year: int | None = None
    phone: str | None = None
    face_enrolled: bool
    must_change_password: bool
    is_active: bool
    created_at: datetime


class MeOut(ProfileOut):
    # True when the user must change the default password before using the system.
    force_password_change: bool = False


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=254, description="Registration number or email")
    password: str = Field(min_length=1, max_length=128)


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_at: int | None = None
    profile: ProfileOut


def validate_new_password(value: str) -> str:
    """Minimum 8 characters with at least one letter and one number (spec 8.5)."""
    if len(value) < 8:
        raise ValueError("must be at least 8 characters")
    if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
        raise ValueError("must contain at least one letter and one number")
    return value


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(max_length=128)

    _check_new = field_validator("new_password")(validate_new_password)

    @model_validator(mode="after")
    def _different(self) -> "ChangePasswordRequest":
        if self.new_password == self.current_password:
            raise ValueError("The new password must be different from the current one")
        return self


class ChangePasswordResponse(BaseModel):
    """New tokens: changing the password ends every old session, including this one."""

    message: str
    access_token: str
    refresh_token: str


class MessageOut(BaseModel):
    message: str
