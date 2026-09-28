"""Student tools (spec 13.4): invoices, simulated payment, attendance."""

from typing import Any

from app.assistant.registry import Tool, ToolContext, ToolError, ToolOutcome, register
from app.assistant.resolvers import resolve_course, resolve_fee, resolve_invoice
from app.assistant.tools._helpers import money, navigate, obj, refresh, s
from app.services import attendance_service, finance_service

STUDENT = ("student",)


def _invoice_dict(inv) -> dict[str, Any]:
    return {"invoice_number": inv.invoice_number, "fee": inv.fee_type.name, "amount": inv.amount,
            "amount_spoken": money(inv.amount, inv.currency), "status": inv.status,
            "due_date": inv.due_date.strftime("%d %B %Y"), "overdue": inv.overdue}


def _all_my_invoices(ctx: ToolContext) -> list[dict[str, Any]]:
    return [i.model_dump(mode="json") for i in finance_service.list_invoices(ctx.user, page_size=100).items]


# --------------------------------------------------------------------------- invoices

def _create_invoice(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    fees = [f.model_dump() for f in finance_service.list_fee_types()]
    fee = resolve_fee(args.get("fee", ""), fees)
    result = finance_service.create_invoice(ctx.user, fee["id"], stated_amount=args.get("stated_amount"), via="voice")
    return ToolOutcome(
        data={"ok": True, "created": result.created, "message": result.message, "invoice": _invoice_dict(result.invoice),
              "official_amount_spoken": money(result.official_amount), "stated_amount_differed": result.amount_differs,
              "next_step": "Ask whether the user wants to pay now or later."},
        ui_actions=[refresh("finance")],
    )


register(Tool(
    name="create_invoice",
    description=("Create an invoice for one of the official fees (e.g. 'tuition', 'medical insurance', 'registration', "
                 "'library'). The official amount is always used. If the user said an amount, pass it as stated_amount so "
                 "you can tell them when it differs. If an unpaid invoice for that fee already exists, it is returned instead."),
    input_schema=obj({"fee": s("Fee name or type the user asked for, e.g. 'tuition'"),
                      "stated_amount": {"type": "number", "description": "Amount the user said, if any"}}, ["fee"]),
    roles=STUDENT, run=_create_invoice,
))


def _list_invoices(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    status = args.get("status") if args.get("status") in ("unpaid", "paid", "cancelled") else None
    result = finance_service.list_invoices(ctx.user, status_filter=status, page_size=50)
    return ToolOutcome(data={"invoices": [_invoice_dict(i) for i in result.items],
                             "outstanding_total_spoken": money(result.outstanding_total or 0)})


register(Tool(
    name="list_my_invoices",
    description="The student's invoices, optionally only 'unpaid', 'paid' or 'cancelled', plus the total still owed.",
    input_schema=obj({"status": {"type": "string", "enum": ["unpaid", "paid", "cancelled"]}}),
    roles=STUDENT, run=_list_invoices,
))


def _prepare_pay(ctx: ToolContext, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    inv = resolve_invoice(args.get("invoice_number"), _all_my_invoices(ctx), only_unpaid=True)
    method = args.get("method") or "card"
    if method not in ("card", "mobile_money"):
        raise ToolError("The payment method must be card or mobile money.")
    label = "card" if method == "card" else "mobile money"
    summary = (f"Pay {money(inv['amount'], inv['currency'])} for invoice {inv['invoice_number']} "
               f"({inv['fee_type']['name']}) by {label} - simulated, no real money is charged.")
    return summary, {"invoice_id": inv["id"], "method": method}


def _pay(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    r = finance_service.pay_invoice(ctx.user, args["invoice_id"], args.get("method", "card"), via="voice")
    return ToolOutcome(
        data={"ok": True, "message": r.message, "receipt_number": r.payment.reference,
              "amount_spoken": money(r.payment.amount, r.payment.currency), "invoice_number": r.invoice.invoice_number,
              "receipt_emailed_to": ctx.user.email},
        ui_actions=[refresh("finance")],
    )


register(Tool(
    name="pay_invoice",
    description=("Pay one of the student's unpaid invoices (simulated payment, card by default). Needs the user's "
                 "confirmation. If invoice_number is omitted and there is exactly one unpaid invoice, that one is used."),
    input_schema=obj({"invoice_number": s("e.g. INV-2026-000142, or just its last digits"),
                      "method": {"type": "string", "enum": ["card", "mobile_money"]}}),
    roles=STUDENT, run=_pay, requires_confirmation=True, prepare=_prepare_pay,
))


# --------------------------------------------------------------------------- attendance

def _open_sessions(ctx: ToolContext, _: dict[str, Any]) -> ToolOutcome:
    sessions = attendance_service.open_sessions_for_student(ctx.user)
    return ToolOutcome(data={
        "open_sessions": [{"course": x.course.code, "course_title": x.course.title, "title": x.title,
                           "minutes_left": max(1, round(x.seconds_left / 60)), "already_marked": x.marked} for x in sessions],
        "face_enrolled": bool(ctx.user.profile.get("face_enrolled")),
        "note": "Marking needs the class code and the camera, so it cannot be done by voice; offer to open the marking page.",
    })


register(Tool(
    name="list_open_attendance_sessions",
    description="Attendance sessions open right now for the student's courses, with minutes left and whether they already marked.",
    input_schema=obj({}), roles=STUDENT, run=_open_sessions,
))


def _open_marking(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    sessions = [x for x in attendance_service.open_sessions_for_student(ctx.user) if not x.marked]
    if not sessions:
        return ToolOutcome(data={"ok": False, "error": "There is no open attendance session to mark right now."})
    if args.get("course"):
        course = resolve_course(args["course"], [x.course.model_dump() for x in sessions])
        session = next(x for x in sessions if x.course.id == course["id"])
    elif len(sessions) == 1:
        session = sessions[0]
    else:
        raise ToolError("Which course?", [f"{x.course.code} {x.course.title}" for x in sessions])
    return ToolOutcome(data={"ok": True, "opened": f"attendance marking for {session.course.code}"},
                       ui_actions=[navigate(f"/student/attendance/{session.id}/mark")])


register(Tool(
    name="open_attendance_marking",
    description="Open the page where the student marks attendance (class code + face check) for an open session.",
    input_schema=obj({"course": s("Course code or title; optional when only one session is open")}),
    roles=STUDENT, run=_open_marking,
))


def _my_attendance(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    rows = attendance_service.my_attendance(ctx.user)
    if args.get("course"):
        course = resolve_course(args["course"], [r.course.model_dump() for r in rows])
        rows = [r for r in rows if r.course.id == course["id"]]
    return ToolOutcome(data={"courses": [
        {"course": r.course.code, "title": r.course.title, "percent": r.percent, "attended": r.attended,
         "sessions": r.total, "below_75_percent": r.low,
         "recent": [{"date": h.opens_at.strftime("%d %b"), "present": h.present} for h in r.history[:5]]}
        for r in rows]})


register(Tool(
    name="get_my_attendance",
    description="The student's attendance percentage and recent sessions, for all courses or one course.",
    input_schema=obj({"course": s("Course code or title (optional)")}),
    roles=STUDENT, run=_my_attendance,
))
