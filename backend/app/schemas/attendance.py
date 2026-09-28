"""Request/response models for attendance sessions, marking and reports."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.academics import PersonRef
from app.schemas.face import FrameIn


class CourseRef(BaseModel):
    id: str
    code: str
    title: str


class CreateSessionRequest(BaseModel):
    course_id: str
    duration_minutes: int = Field(default=15, ge=5, le=60)
    title: str | None = Field(default=None, max_length=120)

    @field_validator("title")
    @classmethod
    def _title(cls, v: str | None) -> str | None:
        return " ".join(v.split()) or None if v else None


class UpdateSessionRequest(BaseModel):
    action: Literal["extend", "regenerate_code", "close"]
    minutes: int | None = Field(default=None, ge=1, le=60)  # for "extend"


class ManualMarkRequest(BaseModel):
    student_id: str
    reason: str = Field(min_length=3, max_length=300)

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: str) -> str:
        v = " ".join(v.split())
        if len(v) < 3:
            raise ValueError("please give a reason")
        return v


class RecordOut(BaseModel):
    student: PersonRef
    marked_at: datetime
    method: Literal["face", "manual"]
    similarity: float | None = None
    manual_reason: str | None = None


class SessionOut(BaseModel):
    id: str
    course: CourseRef
    title: str
    opens_at: datetime
    closes_at: datetime
    status: Literal["open", "closed"]
    created_via: Literal["ui", "voice"]
    seconds_left: int
    present_count: int
    enrolled_count: int


class SessionDetail(SessionOut):
    code: str | None = None          # only for the owning teacher (and admins)
    present: list[RecordOut] = []
    absent: list[PersonRef] = []


class StudentSessionOut(BaseModel):
    """What a student sees about a session - never the class code."""

    id: str
    course: CourseRef
    title: str
    closes_at: datetime
    seconds_left: int
    status: Literal["open", "closed"]
    marked: bool
    marked_at: datetime | None = None


class VerifyCodeRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^[0-9]{6}$")


class MarkRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^[0-9]{6}$")
    challenge_id: str = Field(max_length=64)
    frames: list[FrameIn] = Field(min_length=2, max_length=2)


class MarkResult(BaseModel):
    message: str
    course: CourseRef
    marked_at: datetime


class HistoryItem(BaseModel):
    session_id: str
    title: str
    opens_at: datetime
    status: Literal["open", "closed"]
    present: bool
    method: Literal["face", "manual"] | None = None


class CourseAttendance(BaseModel):
    course: CourseRef
    attended: int
    total: int
    percent: float | None     # None when no sessions have happened yet
    low: bool
    history: list[HistoryItem]


class ReportRow(BaseModel):
    course: CourseRef
    student: PersonRef
    attended: int
    total: int
    percent: float | None
    low: bool


class AttendanceReport(BaseModel):
    threshold: float
    rows: list[ReportRow]
    sessions_count: int
