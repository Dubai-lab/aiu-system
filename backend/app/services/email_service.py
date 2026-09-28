"""Email sending (spec Section 9).

* Templates are Jinja2: an HTML version plus a plain-text alternative.
* Sending never blocks the request: queue_email() hands the work to the
  background pool, so the admin's screen never waits for the mail server.
* EMAIL_MODE=console prints the email in the backend terminal instead of sending.
* Every attempt is recorded in email_logs, so a failed credentials email can be
  shown to the admin with a "Resend" button.
"""

import asyncio
import logging
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path
from typing import Any

import aiosmtplib
from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

from app.core.background import run_in_background
from app.core.config import get_settings
from app.db.supabase_client import service_client

logger = logging.getLogger(__name__)

_TEMPLATE_DIR = Path(__file__).resolve().parents[1] / "email_templates"
_env = Environment(
    loader=FileSystemLoader(_TEMPLATE_DIR),
    autoescape=select_autoescape(enabled_extensions=("html",), default_for_string=False),
    undefined=StrictUndefined,  # a missing value is a bug, never a blank in an email
    trim_blocks=True,
    lstrip_blocks=True,
)


@dataclass(frozen=True)
class TemplateSpec:
    file: str      # template file name without extension
    subject: str   # may use {university}


# Template name (as logged in email_logs) -> file + subject. Teacher and admin
# welcomes share one layout with a different role label.
TEMPLATES: dict[str, TemplateSpec] = {
    "student_welcome": TemplateSpec("student_welcome", "Welcome to {university} - Your student account"),
    "teacher_welcome": TemplateSpec("staff_welcome", "Welcome to {university} - Your teacher account"),
    "admin_welcome": TemplateSpec("staff_welcome", "Welcome to {university} - Your administrator account"),
    "password_reset_by_admin": TemplateSpec("password_reset_by_admin", "{university} - Your password has been reset"),
    "password_changed": TemplateSpec("password_changed", "{university} - Your password was changed"),
    "invoice_created": TemplateSpec("invoice_created", "{university} - New invoice"),
    "payment_receipt": TemplateSpec("payment_receipt", "{university} - Payment receipt"),
}

# Templates that carry login credentials (used for the "email failed - Resend" warning).
CREDENTIAL_TEMPLATES = ("student_welcome", "teacher_welcome", "admin_welcome", "password_reset_by_admin")


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    html: str
    text: str


def render(template: str, context: dict[str, Any]) -> RenderedEmail:
    """Render subject, HTML and text for a template (pure function; used by tests)."""
    spec = TEMPLATES[template]
    settings = get_settings()
    ctx = {
        "university": settings.UNIVERSITY_NAME,
        "login_url": f"{settings.APP_BASE_URL.rstrip('/')}/login",
        **context,
    }
    subject = spec.subject.format(university=settings.UNIVERSITY_NAME)
    html = _env.get_template(f"{spec.file}.html").render(subject=subject, **ctx)
    text = _env.get_template(f"{spec.file}.txt").render(**ctx)
    return RenderedEmail(subject=subject, html=html, text=text)


def _build_message(to_email: str, email: RenderedEmail) -> EmailMessage:
    s = get_settings()
    sender = s.EMAIL_FROM_ADDRESS or s.SMTP_USER
    msg = EmailMessage()
    msg["Subject"] = email.subject
    msg["From"] = formataddr((s.EMAIL_FROM_NAME, sender))
    msg["To"] = to_email
    msg["Message-ID"] = make_msgid(domain=sender.split("@")[-1] if "@" in sender else None)
    msg.set_content(email.text)
    msg.add_alternative(email.html, subtype="html")
    return msg


_RESERVED_TEST_DOMAINS = ("example.com", "example.org", "example.net")
_RESERVED_TEST_TLDS = (".test", ".example", ".invalid", ".localhost")


def _is_reserved_test_address(address: str) -> bool:
    domain = address.rsplit("@", 1)[-1].lower()
    return (domain in _RESERVED_TEST_DOMAINS
            or domain.endswith(tuple("." + d for d in _RESERVED_TEST_DOMAINS))   # e.g. demo.example.org
            or domain.endswith(_RESERVED_TEST_TLDS))


def _deliver(to_email: str, email: RenderedEmail) -> None:
    s = get_settings()
    # Reserved test domains (RFC 2606) can never receive mail: print instead of
    # sending, so test accounts never cause bounce messages in the real inbox.
    if s.EMAIL_MODE == "console" or _is_reserved_test_address(to_email):
        bar = "=" * 72
        print(f"\n{bar}\nEMAIL (console mode) to: {to_email}\nSubject: {email.subject}\n{bar}\n{email.text}\n{bar}\n",
              flush=True)
        return
    if not s.SMTP_USER or not s.SMTP_PASSWORD.get_secret_value():
        raise RuntimeError("SMTP is not configured (SMTP_USER / SMTP_PASSWORD are empty)")
    asyncio.run(
        aiosmtplib.send(
            _build_message(to_email, email),
            hostname=s.SMTP_HOST,
            port=s.SMTP_PORT,
            username=s.SMTP_USER,
            password=s.SMTP_PASSWORD.get_secret_value(),
            start_tls=s.SMTP_PORT == 587,
            use_tls=s.SMTP_PORT == 465,
            timeout=30,
        )
    )


def send_now(template: str, to_email: str, context: dict[str, Any], related_user_id: str | None = None) -> bool:
    """Render, deliver and log one email. Returns True on success; never raises."""
    try:
        email = render(template, context)
    except Exception:  # noqa: BLE001
        logger.exception("Could not render email template %s", template)
        return False

    status, error = "sent", None
    try:
        _deliver(to_email, email)
    except Exception as exc:  # noqa: BLE001
        status, error = "failed", f"{exc.__class__.__name__}: {exc}"[:500]
        logger.warning("Email %s to %s failed: %s", template, to_email, error)

    try:
        service_client().table("email_logs").insert(
            {
                "to_email": to_email,
                "template": template,
                "subject": email.subject,
                "status": status,
                "error": error,
                "related_user_id": related_user_id,
            }
        ).execute()
    except Exception:  # noqa: BLE001
        logger.exception("Could not write email_logs row")
    return status == "sent"


def queue_email(template: str, to_email: str, context: dict[str, Any], related_user_id: str | None = None) -> None:
    """Send in the background. The context may contain a password: it lives only in
    memory for the duration of the send and is never stored or logged."""
    if template not in TEMPLATES:
        raise ValueError(f"Unknown email template: {template}")
    run_in_background(send_now, template, to_email, context, related_user_id)


def latest_credentials_email(user_id: str) -> dict[str, Any] | None:
    """Most recent credentials email for a user (for the admin's Resend warning)."""
    result = (
        service_client().table("email_logs")
        .select("template, status, error, created_at")
        .eq("related_user_id", user_id)
        .in_("template", list(CREDENTIAL_TEMPLATES))
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None
