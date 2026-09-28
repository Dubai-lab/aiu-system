"""Fees, invoices and simulated payments (spec 12 + section 15).

Fee types: everyone logged in can read active fees; admins manage them.
Invoices: students see and create their own; admins see all, create for a student, cancel.
Payments: students pay their own invoices (simulated); receipts for students (own) and admins.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, status

from app.core.security import AdminDep, CurrentUser, CurrentUserDep, StudentDep, client_ip, require_roles
from app.schemas.finance import (
    CancelInvoiceRequest,
    CreateInvoiceRequest,
    CreateInvoiceResult,
    FeeTypeIn,
    FeeTypeOut,
    FeeTypeUpdate,
    InvoiceDetail,
    InvoiceListResponse,
    PayRequest,
    PayResult,
    ReceiptOut,
)
from app.services import finance_service

router = APIRouter(tags=["finance"])
StudentOrAdmin = Annotated[CurrentUser, Depends(require_roles("student", "admin"))]


# ------------------------------------------------------------------ fee types
@router.get("/fees", response_model=list[FeeTypeOut])
def list_fees(user: CurrentUserDep, include_inactive: bool = False) -> list[FeeTypeOut]:
    # Only admins can see fees that are no longer offered.
    return finance_service.list_fee_types(include_inactive=include_inactive and user.role == "admin")


@router.post("/fees", response_model=FeeTypeOut, status_code=status.HTTP_201_CREATED)
def create_fee(body: FeeTypeIn, admin: AdminDep, request: Request) -> FeeTypeOut:
    return finance_service.create_fee_type(admin, body, ip=client_ip(request))


@router.patch("/fees/{fee_type_id}", response_model=FeeTypeOut)
def update_fee(fee_type_id: str, body: FeeTypeUpdate, admin: AdminDep, request: Request) -> FeeTypeOut:
    return finance_service.update_fee_type(admin, fee_type_id, body, ip=client_ip(request))


# ------------------------------------------------------------------ invoices
@router.get("/invoices", response_model=InvoiceListResponse)
def list_invoices(
    viewer: StudentOrAdmin,
    status_filter: Literal["unpaid", "paid", "cancelled"] | None = Query(default=None, alias="status"),
    student_id: str | None = None,
    fee_type_id: str | None = None,
    search: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> InvoiceListResponse:
    return finance_service.list_invoices(viewer, status_filter=status_filter, student_id=student_id,
                                         fee_type_id=fee_type_id, search=search, page=page, page_size=page_size)


@router.post("/invoices", response_model=CreateInvoiceResult)
def create_invoice(body: CreateInvoiceRequest, viewer: StudentOrAdmin, request: Request) -> CreateInvoiceResult:
    return finance_service.create_invoice(viewer, body.fee_type_id, student_id=body.student_id,
                                          stated_amount=body.stated_amount, ip=client_ip(request))


@router.get("/invoices/{invoice_id}", response_model=InvoiceDetail)
def get_invoice(invoice_id: str, viewer: StudentOrAdmin) -> InvoiceDetail:
    return finance_service.get_invoice(viewer, invoice_id)


@router.post("/invoices/{invoice_id}/cancel", response_model=InvoiceDetail)
def cancel_invoice(invoice_id: str, body: CancelInvoiceRequest, admin: AdminDep, request: Request) -> InvoiceDetail:
    return finance_service.cancel_invoice(admin, invoice_id, body.reason, ip=client_ip(request))


# ------------------------------------------------------------------ payments
@router.post("/invoices/{invoice_id}/pay", response_model=PayResult)
def pay_invoice(invoice_id: str, body: PayRequest, student: StudentDep, request: Request) -> PayResult:
    """SIMULATED payment - no real money. Test card 4000 0000 0000 0002 is always declined."""
    return finance_service.pay_invoice(student, invoice_id, body.method, card=body.card, phone=body.phone,
                                       ip=client_ip(request))


@router.get("/payments/{payment_id}", response_model=ReceiptOut)
def get_receipt(payment_id: str, viewer: StudentOrAdmin) -> ReceiptOut:
    return finance_service.get_receipt(viewer, payment_id)
