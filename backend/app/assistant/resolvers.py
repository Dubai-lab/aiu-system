"""Turn human-friendly names into records (spec 13.4): course codes or titles,
department names, people, fee names, invoice numbers. When a name is unknown or
ambiguous, raise ToolError listing the valid options so the assistant can ask."""

import difflib
import re
from typing import Any

from app.assistant.registry import ToolError
from app.db.supabase_client import service_client
from app.schemas.academics import normalise_course_code


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", (text or "").lower())).strip()


def _pick(query: str, items: list[dict[str, Any]], keys: list[str], what: str, label) -> dict[str, Any]:
    """Exact key match, then substring match, then fuzzy match. Ambiguity -> ask."""
    q = _norm(query)
    if not q:
        raise ToolError(f"Which {what}?", [label(i) for i in items][:15])
    for key in keys:
        exact = [i for i in items if _norm(str(i.get(key) or "")) == q]
        if len(exact) == 1:
            return exact[0]
    contains = [i for i in items if any(q in _norm(str(i.get(k) or "")) for k in keys)]
    if len(contains) == 1:
        return contains[0]
    if len(contains) > 1:
        raise ToolError(f"More than one {what} matches '{query}'. Which one?", [label(i) for i in contains][:15])
    names = {label(i): i for i in items}
    close = difflib.get_close_matches(query, list(names), n=3, cutoff=0.6)
    if len(close) == 1:
        return names[close[0]]
    raise ToolError(f"I couldn't find a {what} called '{query}'.", [label(i) for i in items][:15])


# --------------------------------------------------------------------------- courses / departments

def course_label(c: dict[str, Any]) -> str:
    return f"{c['code']} {c['title']}"


def resolve_course(query: str, courses: list[dict[str, Any]], *, what: str = "course") -> dict[str, Any]:
    """Match 'CSC 401', 'csc401', or a title like 'software engineering'."""
    if not courses:
        raise ToolError("There are no courses available to you.")
    code = normalise_course_code(query or "")
    by_code = [c for c in courses if c["code"] == code]
    if len(by_code) == 1:
        return by_code[0]
    return _pick(query, courses, ["code", "title"], what, course_label)


def all_courses(active_only: bool = True) -> list[dict[str, Any]]:
    q = service_client().table("courses").select("id, code, title, department_id, teacher_id, is_active")
    if active_only:
        q = q.eq("is_active", True)
    return q.order("code").execute().data


def resolve_department(query: str) -> dict[str, Any]:
    depts = service_client().table("departments").select("id, name, code").order("name").execute().data
    q = (query or "").strip().upper()
    by_code = [d for d in depts if d["code"] == q]
    if len(by_code) == 1:
        return by_code[0]
    return _pick(query, depts, ["name", "code"], "department", lambda d: f"{d['name']} ({d['code']})")


# --------------------------------------------------------------------------- people

def person_label(p: dict[str, Any]) -> str:
    ident = p.get("reg_number") or p.get("email")
    return f"{p['full_name']} ({ident})"


def resolve_user(query: str, role: str | None = None) -> dict[str, Any]:
    """Match a registration number, an email, or a name."""
    db = service_client()
    fields = "id, full_name, email, reg_number, role, is_active, face_enrolled, must_change_password"
    q = (query or "").strip()
    if not q:
        raise ToolError("Who do you mean? Give a name, email or registration number.")
    base = db.table("profiles").select(fields)
    if role:
        base = base.eq("role", role)
    exact = base.or_(f"reg_number.eq.{q.upper()},email.eq.{q.lower()}").execute().data if re.fullmatch(r"[\w.@+-]+", q) else []
    if len(exact) == 1:
        return exact[0]
    safe = re.sub(r"[^\w\s.'-]", " ", q).strip()
    parts = [p for p in safe.split() if len(p) > 1] or [safe]
    candidates = db.table("profiles").select(fields)
    if role:
        candidates = candidates.eq("role", role)
    for part in parts:
        candidates = candidates.ilike("full_name", f"*{part}*")
    found = candidates.limit(10).execute().data
    if len(found) == 1:
        return found[0]
    who = role or "user"
    if len(found) > 1:
        raise ToolError(f"More than one {who} matches '{query}'. Which one?", [person_label(p) for p in found])
    raise ToolError(f"I couldn't find a {who} called '{query}'. Try their email or registration number.")


# --------------------------------------------------------------------------- fees / invoices

_CATEGORY_WORDS = {
    "tuition": "tuition", "school fees": "tuition", "semester": "tuition",
    "medical": "medical_insurance", "insurance": "medical_insurance", "health": "medical_insurance",
    "registration": "registration", "register": "registration",
}


def resolve_fee(query: str, fees: list[dict[str, Any]]) -> dict[str, Any]:
    """Match a fee name ('Library/ICT Fee', 'library') or a category word ('tuition')."""
    if not fees:
        raise ToolError("No fees are available at the moment.")
    q = _norm(query)
    for word, category in _CATEGORY_WORDS.items():
        if word in q:
            same = [f for f in fees if f["category"] == category]
            if len(same) == 1:
                return same[0]
            if len(same) > 1:
                named = [f for f in same if q and q in _norm(f["name"])]
                if len(named) == 1:
                    return named[0]
                raise ToolError(f"There is more than one {category.replace('_', ' ')} fee. Which one?",
                                [f"{f['name']} ({f['amount']} {f['currency']})" for f in same])
    return _pick(query, fees, ["name"], "fee", lambda f: f"{f['name']} ({f['amount']} {f['currency']})")


def resolve_invoice(query: str | None, invoices: list[dict[str, Any]], *, only_unpaid: bool = False) -> dict[str, Any]:
    """'INV-2026-000142', '142', or - when omitted - the only unpaid invoice."""
    pool = [i for i in invoices if i["status"] == "unpaid"] if only_unpaid else invoices
    q = (query or "").strip().upper()
    if not q:
        if len(pool) == 1:
            return pool[0]
        if not pool:
            raise ToolError("There are no unpaid invoices." if only_unpaid else "There are no invoices.")
        raise ToolError("Which invoice?", [f"{i['invoice_number']} {i['fee_type']['name']}" for i in pool][:10])
    exact = [i for i in pool if i["invoice_number"] == q]
    if exact:
        return exact[0]
    digits = re.sub(r"\D", "", q)
    tail = [i for i in pool if digits and re.sub(r"\D", "", i["invoice_number"]).endswith(digits)]
    if len(tail) == 1:
        return tail[0]
    raise ToolError(f"I couldn't find invoice '{query}'.",
                    [f"{i['invoice_number']} {i['fee_type']['name']} ({i['status']})" for i in pool][:10])
