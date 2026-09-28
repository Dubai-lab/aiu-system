"""Fill the system with realistic DEMO data for a presentation, or remove it again.

Usage (from the project root, with the backend virtualenv):
    backend/.venv/Scripts/python scripts/seed_demo.py            # add demo data
    backend/.venv/Scripts/python scripts/seed_demo.py --remove   # remove it again

What it adds (all through the normal service-layer functions, so audit logs and
business rules apply exactly as in the app):
  * 2 teachers and 8 students, all at @demo.example.org - a reserved test domain,
    so NO real email is ever sent (the emails print to the console instead).
  * 3 demo courses (CSC210, CSC320, NUR210) with the teachers assigned and students enrolled.
  * About two weeks of closed attendance sessions with face / manual marks
    (one student is deliberately below the attendance threshold).
  * Registration-fee invoices for everyone - half paid by simulated card -
    plus a few unpaid tuition invoices.

All demo accounts share one password, written to scripts/demo_credentials.txt
(git-ignored). The script never touches real users, courses or fees; --remove
deletes only @demo.example.org accounts and the demo courses they teach.
"""

import argparse
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.core import background  # noqa: E402
from app.core.passwords import generate_default_password  # noqa: E402
from app.core.security import CurrentUser  # noqa: E402
from app.db.supabase_client import service_client  # noqa: E402
from app.schemas.academics import CourseIn  # noqa: E402
from app.schemas.finance import CardDetails  # noqa: E402
from app.schemas.users import RegisterStaffRequest, RegisterStudentRequest  # noqa: E402
from app.services import academic_service, audit_service, finance_service, user_service  # noqa: E402

DOMAIN = "demo.example.org"
CREDENTIALS_FILE = Path(__file__).resolve().parent / "demo_credentials.txt"

# (email local part, full name, department code, staff title)
TEACHERS = [
    ("musa.kamara", "Dr. Musa Kamara", "CSC", "Senior Lecturer"),
    ("fatu.johnson", "Mrs. Fatu Johnson", "NUR", "Lecturer"),
]
# (email local part, full name, department code, level)
STUDENTS = [
    ("aminata.sesay", "Aminata Sesay", "CSC", 300),
    ("joseph.doe", "Joseph Doe", "CSC", 300),
    ("grace.kollie", "Grace Kollie", "CSC", 200),
    ("emmanuel.togba", "Emmanuel Togba", "CSC", 300),
    ("patience.flomo", "Patience Flomo", "NUR", 200),
    ("samuel.weah", "Samuel Weah", "NUR", 200),
    ("comfort.tarr", "Comfort Tarr", "NUR", 100),
    ("david.zinnah", "David Zinnah", "CSC", 200),
]
# (code, title, department code, teacher email local part, enrolled student local parts)
COURSES = [
    ("CSC210", "Computer Networks", "CSC", "musa.kamara",
     ["aminata.sesay", "joseph.doe", "grace.kollie", "emmanuel.togba", "david.zinnah"]),
    ("CSC320", "Operating Systems", "CSC", "musa.kamara",
     ["aminata.sesay", "joseph.doe", "emmanuel.togba"]),
    ("NUR210", "Human Anatomy", "NUR", "fatu.johnson",
     ["patience.flomo", "samuel.weah", "comfort.tarr"]),
]
# This student attends rarely, so the "below threshold" warnings have something to show.
LOW_ATTENDER = "emmanuel.togba"
SESSIONS_PER_COURSE = 6


def email(local: str) -> str:
    return f"{local}@{DOMAIN}"


def as_user(row: dict) -> CurrentUser:
    """Act as an existing profile when calling service functions (no HTTP request involved)."""
    return CurrentUser(id=row["id"], role=row["role"], email=row["email"], full_name=row["full_name"],
                       profile=row, access_token="")


def seed() -> int:
    db = service_client()
    if db.table("profiles").select("id").like("email", f"%@{DOMAIN}").limit(1).execute().data:
        print("Demo data is already present. Run with --remove first to rebuild it.")
        return 1
    admins = db.table("profiles").select("*").eq("role", "admin").eq("is_active", True).order("created_at").limit(1).execute().data
    if not admins:
        print("No active admin found - run scripts/create_admin.py first.")
        return 1
    admin = as_user(admins[0])
    departments = {d["code"]: d["id"] for d in db.table("departments").select("id, code").execute().data}
    missing = {c for _, _, c, _ in TEACHERS + STUDENTS} - departments.keys()
    if missing:
        print(f"Missing departments {sorted(missing)} - apply supabase/seed.sql first.")
        return 1
    taken = [c[0] for c in COURSES if db.table("courses").select("id").eq("code", c[0]).limit(1).execute().data]
    if taken:
        print(f"Course codes {taken} already exist - the demo will not overwrite real courses.")
        return 1

    password = generate_default_password()
    people: dict[str, dict] = {}

    print("Registering demo teachers and students...")
    for local, name, dept, title in TEACHERS:
        user = user_service.register_user(admin, "teacher", RegisterStaffRequest(
            full_name=name, email=email(local), department_id=departments[dept], staff_title=title), via="system")
        people[local] = {"id": user.id}
    for local, name, dept, level in STUDENTS:
        user = user_service.register_user(admin, "student", RegisterStudentRequest(
            full_name=name, email=email(local), department_id=departments[dept], level=level), via="system")
        people[local] = {"id": user.id}
    # One known password for every demo account, and no forced change, so the demo flows smoothly.
    for local, info in people.items():
        db.auth.admin.update_user_by_id(info["id"], {"password": password})
        db.table("profiles").update({"must_change_password": False}).eq("id", info["id"]).execute()
    rows = db.table("profiles").select("*").in_("id", [p["id"] for p in people.values()]).execute().data
    by_id = {r["id"]: r for r in rows}
    for info in people.values():
        info["row"] = by_id[info["id"]]

    print("Creating demo courses and enrollments...")
    courses: list[tuple[dict, dict, list[str]]] = []
    for code, title, dept, teacher_local, student_locals in COURSES:
        course = academic_service.create_course(admin, CourseIn(
            code=code, title=title, department_id=departments[dept], teacher_id=people[teacher_local]["id"]), via="system")
        student_ids = [people[s]["id"] for s in student_locals]
        academic_service.enroll_students(admin, course.id, student_ids, via="system")
        # Backdate the enrollments: sessions before a student enrolled do not count towards
        # their percentage, and the demo history below starts two weeks ago.
        db.table("enrollments").update({"created_at": (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()}) \
            .eq("course_id", course.id).execute()
        courses.append(({"id": course.id, "code": code}, people[teacher_local], student_ids))

    print("Adding past attendance sessions...")
    rng = random.Random(2026)   # fixed seed: the same demo every time
    now = datetime.now(timezone.utc)
    low_id = people[LOW_ATTENDER]["id"]
    for course, teacher, student_ids in courses:
        for n in range(SESSIONS_PER_COURSE):
            # Spread over the last two weeks; the newest one is earlier today (for "attendance today").
            opens = (now - timedelta(days=(SESSIONS_PER_COURSE - 1 - n) * 2 + rng.randint(0, 1), hours=2)
                     if n < SESSIONS_PER_COURSE - 1 else now - timedelta(hours=1, minutes=rng.randint(5, 50)))
            session = db.table("attendance_sessions").insert({
                "course_id": course["id"], "teacher_id": teacher["id"],
                "title": f"Lecture - {opens.strftime('%d %b %Y')}",
                "opens_at": opens.isoformat(), "closes_at": (opens + timedelta(minutes=15)).isoformat(),
                "status": "closed", "created_via": "voice" if n % 3 == 0 else "ui",
            }).execute().data[0]
            records = []
            for sid in student_ids:
                present = rng.random() < (0.35 if sid == low_id else 0.9)
                if not present:
                    continue
                marked = opens + timedelta(minutes=rng.randint(1, 12), seconds=rng.randint(0, 59))
                manual = rng.random() < 0.1   # the occasional manual mark by the teacher
                # Every row carries the same keys: a bulk insert fills missing keys with NULL.
                records.append({
                    "session_id": session["id"], "student_id": sid, "marked_at": marked.isoformat(),
                    "method": "manual" if manual else "face",
                    "similarity": None if manual else round(rng.uniform(0.58, 0.82), 3),
                    "liveness_passed": not manual,
                    "manual_reason": "Camera problem - confirmed present in class" if manual else None,
                    "marked_by": teacher["id"] if manual else None,
                })
            if records:
                db.table("attendance_records").insert(records).execute()

    print("Creating invoices and simulated payments...")
    fees = {f["category"]: f for f in db.table("fee_types").select("id, name, category").eq("is_active", True).execute().data}
    card = CardDetails(number="4242 4242 4242 4242", expiry="12/30", cvc="123", name="Demo Student")
    for i, (local, *_rest) in enumerate(STUDENTS):
        student = as_user(people[local]["row"])
        if "registration" in fees:
            inv = finance_service.create_invoice(admin, fees["registration"]["id"], student_id=student.id)
            if i % 2 == 0:
                finance_service.pay_invoice(student, inv.invoice.id, "card", card=card)
        if "tuition" in fees and i % 3 == 0:
            finance_service.create_invoice(student, fees["tuition"]["id"])

    audit_service.log("demo.seed", actor_id=None, entity="system",
                      details={"teachers": len(TEACHERS), "students": len(STUDENTS), "courses": len(COURSES)}, via="system")

    lines = [
        "AIU demo accounts - created by scripts/seed_demo.py (git-ignored, do not commit).",
        f"Password for every account below: {password}",
        "",
        "Teachers:",
        *[f"  {name:<22} {email(local)}" for local, name, *_ in TEACHERS],
        "",
        "Students (log in with the registration number - students cannot log in by email):",
        *[f"  {name:<22} {people[local]['row']['reg_number']:<16} {email(local)}" for local, name, *_ in STUDENTS],
        "",
        "Remove everything again with:  backend/.venv/Scripts/python scripts/seed_demo.py --remove",
    ]
    CREDENTIALS_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    background._executor.shutdown(wait=True)   # let the queued (console) emails finish first
    print("\n" + "\n".join(lines))
    print(f"\nSaved to {CREDENTIALS_FILE}")
    return 0


def remove() -> int:
    db = service_client()
    users = db.table("profiles").select("id, email").like("email", f"%@{DOMAIN}").execute().data
    if not users:
        print("No demo data found.")
        return 0
    ids = [u["id"] for u in users]
    demo_codes = [c[0] for c in COURSES]
    # Demo courses taught by demo teachers (cascades their sessions, records and enrollments).
    db.table("courses").delete().in_("code", demo_codes).in_("teacher_id", ids).execute()
    # Anything else the demo users own that does not cascade.
    db.table("attendance_sessions").delete().in_("teacher_id", ids).execute()
    db.table("payments").delete().in_("student_id", ids).execute()
    db.table("invoices").delete().in_("student_id", ids).execute()
    db.table("email_logs").delete().like("to_email", f"%@{DOMAIN}").execute()
    for uid in ids:
        db.auth.admin.delete_user(uid)   # the profile row cascades from auth.users
    CREDENTIALS_FILE.unlink(missing_ok=True)
    audit_service.log("demo.remove", actor_id=None, entity="system", details={"users": len(ids)}, via="system")
    background._executor.shutdown(wait=True)
    print(f"Removed {len(ids)} demo accounts and their courses, sessions, invoices and payments.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Add or remove AIU demo data.")
    parser.add_argument("--remove", action="store_true", help="remove the demo data instead of adding it")
    return remove() if parser.parse_args().remove else seed()


if __name__ == "__main__":
    raise SystemExit(main())
