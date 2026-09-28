"""The current user's own account (/me) and admin user management (/users)."""

from typing import Literal

from fastapi import APIRouter, Query, Request, status

from app.core.security import AdminDep, CurrentUserDep, client_ip
from app.schemas.auth import ChangePasswordRequest, ChangePasswordResponse, MeOut
from app.schemas.users import (
    RegisterStaffRequest,
    RegisterStudentRequest,
    UpdateUserRequest,
    UserDetail,
    UserListResponse,
)
from app.services import auth_service, user_service

router = APIRouter(tags=["users"])


# ------------------------------------------------------------------ own account

@router.get("/me", response_model=MeOut)
def get_me(user: CurrentUserDep) -> MeOut:
    return user_service.to_me_out(user.profile)


@router.post("/me/password", response_model=ChangePasswordResponse)
def change_my_password(body: ChangePasswordRequest, user: CurrentUserDep, request: Request) -> ChangePasswordResponse:
    return auth_service.change_password(user, body.current_password, body.new_password, ip=client_ip(request))


# ------------------------------------------------------------------ admin: users

@router.get("/users", response_model=UserListResponse)
def list_users(
    _: AdminDep,
    role: Literal["admin", "teacher", "student"] | None = None,
    search: str | None = Query(default=None, max_length=100),
    department_id: str | None = None,
    is_active: bool | None = None,
    level: int | None = Query(default=None, ge=100, le=400),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> UserListResponse:
    return user_service.list_users(role=role, search=search, department_id=department_id,
                                   is_active=is_active, level=level, page=page, page_size=page_size)


@router.post("/users/students", response_model=UserDetail, status_code=status.HTTP_201_CREATED)
def register_student(body: RegisterStudentRequest, admin: AdminDep, request: Request) -> UserDetail:
    return user_service.register_user(admin, "student", body, ip=client_ip(request))


@router.post("/users/teachers", response_model=UserDetail, status_code=status.HTTP_201_CREATED)
def register_teacher(body: RegisterStaffRequest, admin: AdminDep, request: Request) -> UserDetail:
    return user_service.register_user(admin, "teacher", body, ip=client_ip(request))


@router.post("/users/admins", response_model=UserDetail, status_code=status.HTTP_201_CREATED)
def register_admin(body: RegisterStaffRequest, admin: AdminDep, request: Request) -> UserDetail:
    return user_service.register_user(admin, "admin", body, ip=client_ip(request))


@router.get("/users/{user_id}", response_model=UserDetail)
def get_user(user_id: str, _: AdminDep) -> UserDetail:
    return user_service.get_user_detail(user_id)


@router.patch("/users/{user_id}", response_model=UserDetail)
def update_user(user_id: str, body: UpdateUserRequest, admin: AdminDep, request: Request) -> UserDetail:
    return user_service.update_user(admin, user_id, body, ip=client_ip(request))


@router.post("/users/{user_id}/reset-password", response_model=UserDetail)
def reset_password(user_id: str, admin: AdminDep, request: Request) -> UserDetail:
    return user_service.reset_password(admin, user_id, ip=client_ip(request))


@router.post("/users/{user_id}/resend-credentials", response_model=UserDetail)
def resend_credentials(user_id: str, admin: AdminDep, request: Request) -> UserDetail:
    return user_service.resend_credentials(admin, user_id, ip=client_ip(request))
