"""Request/response models for admin user management."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.auth import ProfileOut

Level = Literal[100, 200, 300, 400]


def _clean_name(value: str) -> str:
    value = " ".join(value.split())
    if len(value) < 2:
        raise ValueError("must be at least 2 characters")
    return value


def _clean_phone(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


class _RegisterBase(BaseModel):
    full_name: str = Field(max_length=120)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=30)

    _name = field_validator("full_name")(_clean_name)
    _phone = field_validator("phone")(_clean_phone)

    @field_validator("email")
    @classmethod
    def _lower_email(cls, value: str) -> str:
        return value.strip().lower()


class RegisterStudentRequest(_RegisterBase):
    department_id: str
    level: Level
    intake_year: int = Field(default_factory=lambda: date.today().year, ge=2000, le=2100)


class RegisterStaffRequest(_RegisterBase):
    """Teachers and admins. A department is optional for admins (e.g. a Dean)."""

    department_id: str | None = None
    staff_title: str | None = Field(default=None, max_length=80)

    @field_validator("staff_title")
    @classmethod
    def _clean_title(cls, value: str | None) -> str | None:
        return " ".join(value.split()) or None if value else None


class UpdateUserRequest(BaseModel):
    """Fields an admin may edit. Email and role are fixed once created."""

    full_name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    department_id: str | None = None
    level: Level | None = None
    staff_title: str | None = Field(default=None, max_length=80)
    is_active: bool | None = None  # activate / deactivate

    @field_validator("full_name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        return _clean_name(value) if value is not None else None

    _phone = field_validator("phone")(_clean_phone)


class UserListItem(BaseModel):
    id: str
    role: str
    full_name: str
    email: str
    reg_number: str | None = None
    staff_title: str | None = None
    department_code: str | None = None
    level: int | None = None
    face_enrolled: bool
    must_change_password: bool
    is_active: bool
    created_at: datetime


class UserListResponse(BaseModel):
    items: list[UserListItem]
    total: int
    page: int
    page_size: int


class CourseRef(BaseModel):
    id: str
    code: str
    title: str


class CredentialsEmailStatus(BaseModel):
    template: str
    status: Literal["sent", "failed"]
    error: str | None = None
    created_at: datetime


class UserDetail(ProfileOut):
    courses: list[CourseRef] = []          # enrolled (student) or taught (teacher)
    credentials_email: CredentialsEmailStatus | None = None


class RegisterResponse(BaseModel):
    user: UserDetail
    message: str
