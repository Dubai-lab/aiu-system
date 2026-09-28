"""Face enrollment (admin only). Users can never enroll their own face through
these routes unless they are an admin (spec 10.4)."""

from fastapi import APIRouter, Request

from app.core.security import AdminDep, client_ip
from app.schemas.face import EnrollRequest, FaceServiceStatus
from app.schemas.users import UserDetail
from app.services import face_enrollment_service, face_service_client

router = APIRouter(prefix="/face", tags=["face"])


@router.get("/status", response_model=FaceServiceStatus)
def face_service_status(_: AdminDep) -> FaceServiceStatus:
    h = face_service_client.health()
    return FaceServiceStatus(status=h.get("status", "offline"), model_loaded=bool(h.get("model_loaded")))


@router.post("/{user_id}/enroll", response_model=UserDetail)
def enroll(user_id: str, body: EnrollRequest, admin: AdminDep, request: Request) -> UserDetail:
    return face_enrollment_service.enroll_face(admin, user_id, body.consent, body.frames, ip=client_ip(request))


@router.delete("/{user_id}", response_model=UserDetail)
def remove(user_id: str, admin: AdminDep, request: Request) -> UserDetail:
    return face_enrollment_service.remove_face(admin, user_id, ip=client_ip(request))
