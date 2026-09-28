"""Request/response models for fee types, invoices and simulated payments."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

FeeCategory = Literal["tuition", "medical_insurance", "registration", "other"]
InvoiceStatus = Literal["unpaid", "paid", "cancelled"]
PaymentMethod = Literal["card", "mobile_money"]


def _clean(v: str) -> str:
    return " ".join(v.split())


class FeeTypeIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    category: FeeCategory
    amount: Decimal = Field(gt=0, le=Decimal("1000000"), decimal_places=2)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    description: str | None = Field(default=None, max_length=300)

    _name = field_validator("name")(_clean)


class FeeTypeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    category: FeeCategory | None = None
    amount: Decimal | None = Field(default=None, gt=0, le=Decimal("1000000"), decimal_places=2)
    description: str | None = Field(default=None, max_length=300)
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return _clean(v) if v is not None else None


class FeeTypeOut(BaseModel):
    id: str
    name: str
    category: FeeCategory
    amount: float
    currency: str
    description: str | None = None
    is_active: bool


class StudentRef(BaseModel):
    id: str
    full_name: str
    email: str
    reg_number: str | None = None


class FeeRef(BaseModel):
    id: str
    name: str
    category: FeeCategory


class PaymentOut(BaseModel):
    id: str
    reference: str
    amount: float
    currency: str
    method: PaymentMethod
    status: Literal["success", "failed"]
    failure_reason: str | None = None
    is_simulated: bool
    paid_at: datetime


class InvoiceOut(BaseModel):
    id: str
    invoice_number: str
    student: StudentRef
    fee_type: FeeRef
    description: str | None = None
    amount: float
    currency: str
    status: InvoiceStatus
    due_date: date
    created_via: Literal["ui", "voice"]
    created_at: datetime
    paid_at: datetime | None = None
    cancelled_at: datetime | None = None
    cancel_reason: str | None = None
    overdue: bool = False
    receipt_payment_id: str | None = None   # the successful payment, when paid


class InvoiceDetail(InvoiceOut):
    payments: list[PaymentOut] = []


class InvoiceListResponse(BaseModel):
    items: list[InvoiceOut]
    total: int
    page: int
    page_size: int
    outstanding_total: float | None = None   # students: sum of their unpaid invoices


class CreateInvoiceRequest(BaseModel):
    """Students: fee_type_id only. Admins: also student_id."""

    fee_type_id: str
    student_id: str | None = None
    stated_amount: Decimal | None = Field(default=None, gt=0)


class CreateInvoiceResult(BaseModel):
    invoice: InvoiceOut
    created: bool                          # False when an unpaid invoice for this fee already existed
    official_amount: float
    stated_amount: float | None = None
    amount_differs: bool = False           # the student stated a different amount (official one was used)
    message: str


class CancelInvoiceRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=300)

    _reason = field_validator("reason")(_clean)


class CardDetails(BaseModel):
    """Fake card data for the SIMULATED checkout. Validated for format, never stored."""

    number: str = Field(min_length=1, max_length=23)   # friendly length check happens in finance_rules
    expiry: str = Field(pattern=r"^\s*\d{2}\s*/\s*\d{2}\s*$")   # MM/YY
    cvc: str = Field(pattern=r"^\d{3,4}$")
    name: str = Field(min_length=2, max_length=80)


class PayRequest(BaseModel):
    method: PaymentMethod = "card"
    card: CardDetails | None = None
    phone: str | None = Field(default=None, max_length=20)


class PayResult(BaseModel):
    message: str
    payment: PaymentOut
    invoice: InvoiceOut


class ReceiptOut(BaseModel):
    university: str
    payment: PaymentOut
    invoice_number: str
    fee_name: str
    student: StudentRef
    department: str | None = None
