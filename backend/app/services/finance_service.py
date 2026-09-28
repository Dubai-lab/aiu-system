"""Fee types, invoices and SIMULATED payments (spec section 12).

Rules live here once; REST routes and (Phase 9) the voice assistant call these.
- Students never type amounts: an invoice copies the official fee amount.
- One unpaid invoice per fee per student (also enforced by a DB unique index).
- Payments are simulated; card numbers are validated for format and never stored.
- record_payment() (SQL, one transaction) makes paying atomic and double-click safe.
"""

import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Literal

from fastapi import status

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import CurrentUser
from app.db.supabase_client import service_client
from app.schemas.finance import (
    CardDetails,
    CreateInvoiceResult,
    FeeTypeIn,
    FeeTypeOut,
    FeeTypeUpdate,
    InvoiceDetail,
    InvoiceListResponse,
    InvoiceOut,
    PaymentOut,
    PayResult,
    ReceiptOut,
    StudentRef,
)
from app.services import audit_service, email_service
from app.services.finance_rules import (
    PaymentDetailsError,
    amounts_differ,
    check_card,
    check_phone,
    is_declined,
    money,
)
from app.services.user_service import is_valid_uuid

logger = logging.getLogger(__name__)

Via = Literal["ui", "voice", "system"]
DUE_DAYS = 30
INVOICE_SELECT = (
    "*, student:profiles!invoices_student_id_fkey(id, full_name, email, reg_number),"
    " fee_type:fee_types(id, name, category),"
    " payments(id, reference, amount, currency, method, status, failure_reason, is_simulated, paid_at)"
)
PAYMENT_FIELDS = "id, reference, amount, currency, method, status, failure_reason, is_simulated, paid_at"


def _not_found(what: str = "Invoice") -> AppError:
    return AppError("not_found", f"{what} not found.", status.HTTP_404_NOT_FOUND)


def _app_url(path: str) -> str:
    return f"{get_settings().APP_BASE_URL.rstrip('/')}{path}"


# =========================================================================== fee types

def list_fee_types(*, include_inactive: bool = False) -> list[FeeTypeOut]:
    q = service_client().table("fee_types").select("*").order("category").order("name")
    if not include_inactive:
        q = q.eq("is_active", True)
    return [FeeTypeOut.model_validate(r) for r in q.execute().data]


def _get_fee(fee_type_id: str) -> dict[str, Any]:
    if not is_valid_uuid(fee_type_id):
        raise _not_found("Fee")
    r = service_client().table("fee_types").select("*").eq("id", fee_type_id).maybe_single().execute()
    if not r or not r.data:
        raise _not_found("Fee")
    return r.data


def _ensure_fee_name_free(name: str, exclude_id: str | None = None) -> None:
    q = service_client().table("fee_types").select("id").ilike("name", name)
    if exclude_id:
        q = q.neq("id", exclude_id)
    if q.execute().data:
        raise AppError("fee_name_taken", "A fee with this name already exists.", status.HTTP_409_CONFLICT)


def create_fee_type(actor: CurrentUser, data: FeeTypeIn, *, via: Via = "ui", ip: str | None = None) -> FeeTypeOut:
    _ensure_fee_name_free(data.name)
    row = service_client().table("fee_types").insert({**data.model_dump(), "amount": str(data.amount)}).execute().data[0]
    audit_service.log("fee.create", actor_id=actor.id, entity="fee_type", entity_id=row["id"],
                      details={"name": data.name, "amount": str(data.amount), "currency": data.currency}, via=via, ip=ip)
    return FeeTypeOut.model_validate(row)


def update_fee_type(actor: CurrentUser, fee_type_id: str, data: FeeTypeUpdate, *, via: Via = "ui",
                    ip: str | None = None) -> FeeTypeOut:
    """Amount changes apply to NEW invoices only; existing invoices keep the amount they were created with."""
    old = _get_fee(fee_type_id)
    patch = data.model_dump(exclude_unset=True, exclude_none=True)
    if "name" in patch:
        _ensure_fee_name_free(patch["name"], exclude_id=fee_type_id)
    if "amount" in patch:
        patch["amount"] = str(patch["amount"])
    if patch:
        row = service_client().table("fee_types").update(patch).eq("id", fee_type_id).execute().data[0]
        details = {k: v for k, v in patch.items()}
        if "amount" in patch:
            details["previous_amount"] = str(old["amount"])
        audit_service.log("fee.update", actor_id=actor.id, entity="fee_type", entity_id=fee_type_id,
                          details=details, via=via, ip=ip)
        return FeeTypeOut.model_validate(row)
    return FeeTypeOut.model_validate(old)


# =========================================================================== invoices

def _invoice_out(row: dict[str, Any], *, detail: bool = False) -> InvoiceOut | InvoiceDetail:
    payments = sorted(row.get("payments") or [], key=lambda p: p["paid_at"], reverse=True)
    success = next((p for p in payments if p["status"] == "success"), None)
    overdue = row["status"] == "unpaid" and date.fromisoformat(row["due_date"]) < date.today()
    data = {**row, "overdue": overdue, "receipt_payment_id": success["id"] if success else None}
    if detail:
        return InvoiceDetail.model_validate({**data, "payments": payments})
    return InvoiceOut.model_validate(data)


def _get_invoice_row(invoice_id: str) -> dict[str, Any]:
    if not is_valid_uuid(invoice_id):
        raise _not_found()
    r = service_client().table("invoices").select(INVOICE_SELECT).eq("id", invoice_id).maybe_single().execute()
    if not r or not r.data:
        raise _not_found()
    return r.data


def _visible_invoice(viewer: CurrentUser, invoice_id: str) -> dict[str, Any]:
    row = _get_invoice_row(invoice_id)
    if viewer.role == "student" and row["student_id"] != viewer.id:
        raise _not_found()   # students only ever see their own invoices
    if viewer.role not in ("student", "admin"):
        raise _not_found()
    return row


def get_invoice(viewer: CurrentUser, invoice_id: str) -> InvoiceDetail:
    return _invoice_out(_visible_invoice(viewer, invoice_id), detail=True)  # type: ignore[return-value]


def list_invoices(viewer: CurrentUser, *, status_filter: str | None = None, student_id: str | None = None,
                  fee_type_id: str | None = None, search: str | None = None, page: int = 1,
                  page_size: int = 20) -> InvoiceListResponse:
    db = service_client()
    page, page_size = max(1, page), min(max(1, page_size), 100)
    q = db.table("invoices").select(INVOICE_SELECT, count="exact")
    if viewer.role == "student":
        q = q.eq("student_id", viewer.id)
    elif student_id and is_valid_uuid(student_id):
        q = q.eq("student_id", student_id)
    if status_filter in ("unpaid", "paid", "cancelled"):
        q = q.eq("status", status_filter)
    if fee_type_id and is_valid_uuid(fee_type_id):
        q = q.eq("fee_type_id", fee_type_id)
    term = (search or "").strip()
    if term and viewer.role == "admin":
        safe = "".join(ch for ch in term if ch.isalnum() or ch in " -@.")
        ids = [p["id"] for p in db.table("profiles").select("id").eq("role", "student").or_(
            f"full_name.ilike.*{safe}*,reg_number.ilike.*{safe}*,email.ilike.*{safe}*").limit(200).execute().data]
        q = q.or_(f"invoice_number.ilike.*{safe}*" + (f",student_id.in.({','.join(ids)})" if ids else ""))
    start = (page - 1) * page_size
    result = q.order("created_at", desc=True).range(start, start + page_size - 1).execute()
    outstanding = None
    if viewer.role == "student":
        unpaid = db.table("invoices").select("amount").eq("student_id", viewer.id).eq("status", "unpaid").execute().data
        outstanding = float(sum(Decimal(str(r["amount"])) for r in unpaid))
    return InvoiceListResponse(items=[_invoice_out(r) for r in result.data], total=result.count or 0,  # type: ignore[misc]
                               page=page, page_size=page_size, outstanding_total=outstanding)


def _existing_unpaid(student_id: str, fee_type_id: str) -> dict[str, Any] | None:
    rows = service_client().table("invoices").select(INVOICE_SELECT).eq("student_id", student_id) \
        .eq("fee_type_id", fee_type_id).eq("status", "unpaid").limit(1).execute().data
    return rows[0] if rows else None


def create_invoice(actor: CurrentUser, fee_type_id: str, *, student_id: str | None = None,
                   stated_amount: Decimal | float | None = None, via: Via = "ui", ip: str | None = None) -> CreateInvoiceResult:
    """Students create their own invoice; admins create one for a student.
    The OFFICIAL fee amount is always used. An existing unpaid invoice for the same fee is returned instead of a duplicate."""
    db = service_client()
    if actor.role == "student":
        student_id = actor.id
        student = actor.profile
    else:
        if not student_id or not is_valid_uuid(student_id):
            raise AppError("student_required", "Choose the student to invoice.")
        r = db.table("profiles").select("id, role, full_name, email, reg_number, is_active").eq("id", student_id) \
            .maybe_single().execute()
        student = r.data if r else None
        if not student or student["role"] != "student":
            raise AppError("student_not_found", "That student does not exist.", status.HTTP_404_NOT_FOUND)
        if not student["is_active"]:
            raise AppError("student_inactive", f"{student['full_name']} is deactivated.")

    fee = _get_fee(fee_type_id)
    if not fee["is_active"]:
        raise AppError("fee_inactive", f"{fee['name']} is no longer offered.")
    official = Decimal(str(fee["amount"]))
    differs = amounts_differ(stated_amount, official)
    amount_note = (f" The official {fee['name']} amount is {money(official, fee['currency'])}, "
                   "so the invoice uses that amount.") if differs else ""

    existing = _existing_unpaid(student_id, fee_type_id)
    if existing:
        inv = _invoice_out(existing)
        return CreateInvoiceResult(
            invoice=inv, created=False, official_amount=float(official),
            stated_amount=float(stated_amount) if stated_amount is not None else None, amount_differs=differs,
            message=f"There is already an unpaid invoice {inv.invoice_number} for {fee['name']} "
                    f"({money(inv.amount, inv.currency)}).{amount_note}")

    number = db.rpc("next_invoice_number", {}).execute().data
    due = date.today() + timedelta(days=DUE_DAYS)
    try:
        row = db.table("invoices").insert({
            "invoice_number": number, "student_id": student_id, "fee_type_id": fee_type_id,
            "description": fee["name"], "amount": str(official), "currency": fee["currency"],
            "status": "unpaid", "due_date": due.isoformat(), "created_by": actor.id, "created_via": via,
        }).execute().data[0]
    except Exception as exc:  # noqa: BLE001 - two requests at once: the unique index keeps one unpaid invoice
        if "invoices_one_unpaid_per_fee" in str(exc):
            existing = _existing_unpaid(student_id, fee_type_id)
            if existing:
                inv = _invoice_out(existing)
                return CreateInvoiceResult(invoice=inv, created=False, official_amount=float(official),
                                           message=f"There is already an unpaid invoice {inv.invoice_number}.")
        raise

    audit_service.log("invoice.create", actor_id=actor.id, entity="invoice", entity_id=row["id"],
                      details={"invoice_number": number, "fee": fee["name"], "amount": str(official),
                               "student_id": student_id, "stated_amount": str(stated_amount) if stated_amount else None},
                      via=via, ip=ip)
    email_service.queue_email("invoice_created", student["email"], {
        "full_name": student["full_name"], "invoice_number": number, "fee_name": fee["name"],
        "amount": money(official, fee["currency"]), "due_date": due.strftime("%d %B %Y"),
        "pay_url": _app_url(f"/student/finance/invoices/{row['id']}/pay"),
    }, related_user_id=student_id)

    inv = _invoice_out(_get_invoice_row(row["id"]))
    return CreateInvoiceResult(
        invoice=inv, created=True, official_amount=float(official),
        stated_amount=float(stated_amount) if stated_amount is not None else None, amount_differs=differs,
        message=f"Invoice {number} created for {fee['name']}: {money(official, fee['currency'])}, "
                f"due on {due.strftime('%d %B %Y')}.{amount_note}")


def cancel_invoice(actor: CurrentUser, invoice_id: str, reason: str, *, via: Via = "ui",
                   ip: str | None = None) -> InvoiceDetail:
    row = _get_invoice_row(invoice_id)
    if row["status"] != "unpaid":
        raise AppError("not_cancellable", f"Only unpaid invoices can be cancelled (this one is {row['status']}).")
    service_client().table("invoices").update({
        "status": "cancelled", "cancelled_at": datetime.now(timezone.utc).isoformat(),
        "cancelled_by": actor.id, "cancel_reason": reason,
    }).eq("id", invoice_id).eq("status", "unpaid").execute()
    audit_service.log("invoice.cancel", actor_id=actor.id, entity="invoice", entity_id=invoice_id,
                      details={"invoice_number": row["invoice_number"], "reason": reason}, via=via, ip=ip)
    return get_invoice(actor, invoice_id)


# =========================================================================== payments (simulated)

def pay_invoice(actor: CurrentUser, invoice_id: str, method: str = "card", *, card: CardDetails | None = None,
                phone: str | None = None, via: Via = "ui", ip: str | None = None) -> PayResult:
    """SIMULATED payment of the student's own invoice. No real money is ever charged.
    In the UI the fake card / phone details are checked for format (never stored).
    By voice (after the user confirms), a simulated saved card is used."""
    row = _visible_invoice(actor, invoice_id)
    if actor.role != "student":
        raise AppError("students_only", "Only the student can pay their own invoice.", status.HTTP_403_FORBIDDEN)
    if row["status"] == "paid":
        raise AppError("already_paid", f"Invoice {row['invoice_number']} is already paid.", status.HTTP_409_CONFLICT)
    if row["status"] == "cancelled":
        raise AppError("invoice_cancelled", f"Invoice {row['invoice_number']} was cancelled and cannot be paid.")
    if method not in ("card", "mobile_money"):
        raise AppError("bad_method", "Choose card or mobile money.")

    card_number: str | None = None
    try:
        if method == "card" and card is not None:
            card_number = check_card(card.number, card.expiry, card.cvc)
        elif method == "card" and via != "voice":
            raise PaymentDetailsError("Enter the card details.")
        if method == "mobile_money" and (phone or via != "voice"):
            check_phone(phone)
    except PaymentDetailsError as exc:
        raise AppError("bad_payment_details", str(exc)) from exc

    declined = is_declined(card_number)
    try:
        pay = service_client().rpc("record_payment", {
            "p_invoice_id": row["id"], "p_student_id": actor.id, "p_method": method,
            "p_success": not declined, "p_failure_reason": "Card declined (test card)" if declined else None,
        }).execute().data
    except Exception as exc:  # noqa: BLE001
        text = str(exc)
        if "invoice_not_payable" in text:
            raise AppError("already_paid", f"Invoice {row['invoice_number']} is already paid.", status.HTTP_409_CONFLICT) from exc
        if "invoice_not_found" in text:
            raise _not_found() from exc
        raise
    payment = PaymentOut.model_validate(pay)
    audit_details = {"invoice_number": row["invoice_number"], "reference": payment.reference, "method": method,
                     "amount": str(row["amount"]), "simulated": True}

    if declined:
        audit_service.log("payment.failed", actor_id=actor.id, entity="payment", entity_id=payment.id,
                          details=audit_details, via=via, ip=ip)
        raise AppError("payment_declined", "Your card was declined (simulated). Try a different card.",
                       status.HTTP_402_PAYMENT_REQUIRED)

    audit_service.log("payment.success", actor_id=actor.id, entity="payment", entity_id=payment.id,
                      details=audit_details, via=via, ip=ip)
    email_service.queue_email("payment_receipt", actor.email, {
        "full_name": actor.full_name, "reference": payment.reference, "invoice_number": row["invoice_number"],
        "fee_name": row["fee_type"]["name"], "amount": money(payment.amount, payment.currency),
        "method": "Card" if method == "card" else "Mobile Money",
        "paid_at": payment.paid_at.strftime("%d %B %Y, %H:%M UTC"), "reg_number": actor.profile.get("reg_number") or "",
        "receipt_url": _app_url(f"/student/finance/receipts/{payment.id}"),
    }, related_user_id=actor.id)
    invoice = _invoice_out(_get_invoice_row(row["id"]))
    return PayResult(message=f"Payment successful. Your receipt number is {payment.reference}.",
                     payment=payment, invoice=invoice)  # type: ignore[arg-type]


def get_receipt(viewer: CurrentUser, payment_id: str) -> ReceiptOut:
    if not is_valid_uuid(payment_id):
        raise _not_found("Receipt")
    r = service_client().table("payments").select(
        f"{PAYMENT_FIELDS}, student_id, invoice:invoices(invoice_number, description, fee_type:fee_types(name)),"
        " student:profiles!payments_student_id_fkey(id, full_name, email, reg_number, department:departments(name))"
    ).eq("id", payment_id).maybe_single().execute()
    p = r.data if r else None
    if not p or p["status"] != "success":
        raise _not_found("Receipt")
    if viewer.role == "student" and p["student_id"] != viewer.id:
        raise _not_found("Receipt")
    if viewer.role not in ("student", "admin"):
        raise _not_found("Receipt")
    student = p["student"]
    return ReceiptOut(
        university=get_settings().UNIVERSITY_NAME,
        payment=PaymentOut.model_validate(p),
        invoice_number=p["invoice"]["invoice_number"],
        fee_name=(p["invoice"].get("fee_type") or {}).get("name") or p["invoice"].get("description") or "",
        student=StudentRef.model_validate(student),
        department=(student.get("department") or {}).get("name"),
    )
