"""Create the first admin account (there is no public sign-up).

Usage (from the project root, with the backend virtualenv):
    backend/.venv/Scripts/python scripts/create_admin.py \
        --email admin@aiu.edu --name "System Administrator" --title "Dean"

The generated password is printed ONCE. The admin should change it after logging in.
"""

import argparse
import sys
from pathlib import Path

# Reuse the backend's settings, Supabase client and password generator.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.core.passwords import generate_default_password  # noqa: E402
from app.db.supabase_client import service_client  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Create the first AIU admin account.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True, help="Full name")
    parser.add_argument("--title", default="Administrator", help="Staff title, e.g. 'Dean'")
    args = parser.parse_args()

    email = args.email.strip().lower()
    db = service_client()

    existing = db.table("profiles").select("id").eq("email", email).limit(1).execute()
    if existing.data:
        print(f"A profile with email {email} already exists. Nothing to do.")
        return 1

    password = generate_default_password()

    # 1. Auth user (email marked confirmed so Supabase sends no email of its own).
    try:
        created = db.auth.admin.create_user(
            {"email": email, "password": password, "email_confirm": True}
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Could not create the auth user: {exc}")
        return 1
    user_id = created.user.id

    # 2. Profile row. If this fails, remove the auth user so nothing is half-created.
    try:
        db.table("profiles").insert(
            {
                "id": user_id,
                "role": "admin",
                "full_name": args.name.strip(),
                "email": email,
                "staff_title": args.title.strip(),
                "must_change_password": True,
            }
        ).execute()
        db.table("audit_logs").insert(
            {
                "actor_id": None,
                "action": "user.create_admin",
                "entity": "profile",
                "entity_id": user_id,
                "details": {"email": email, "source": "scripts/create_admin.py"},
                "via": "system",
            }
        ).execute()
    except Exception as exc:  # noqa: BLE001
        db.auth.admin.delete_user(user_id)
        print(f"Could not create the profile (auth user rolled back): {exc}")
        return 1

    print("Admin account created.")
    print(f"  Email:    {email}")
    print(f"  Password: {password}")
    print("This password is shown only once. Change it from Profile after logging in.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
