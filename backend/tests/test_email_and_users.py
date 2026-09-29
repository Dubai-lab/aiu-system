"""Email rendering, failure logging and user-service helpers (no network)."""

from unittest.mock import MagicMock

import pytest

from app.services import email_service, user_service


def test_student_welcome_contains_login_details():
    email = email_service.render("student_welcome", {
        "full_name": "Jane Doe", "reg_number": "AIU-2026-0001", "email": "jane@example.com", "password": "Kp7#mRx4Ta",
    })
    assert email.subject == "Welcome to AIU - Your student account"
    for part in (email.text, email.html):
        assert "AIU-2026-0001" in part and "Kp7#mRx4Ta" in part and "jane@example.com" in part
        assert "/login" in part
    assert "change your password" in email.text.lower()


@pytest.mark.parametrize("template,role_label", [("teacher_welcome", "teacher"), ("admin_welcome", "administrator")])
def test_staff_welcome(template, role_label):
    email = email_service.render(template, {
        "full_name": "Sam", "email": "sam@aiu.edu", "password": "Pw#12345ab", "role_label": role_label,
    })
    assert f"{role_label} account" in email.text and "sam@aiu.edu" in email.text


def test_html_escapes_user_input():
    email = email_service.render("password_changed", {"full_name": "<script>x</script>", "changed_at": "now"})
    assert "<script>x</script>" not in email.html and "&lt;script&gt;" in email.html
    assert "<script>x</script>" in email.text  # plain text is not HTML


def test_missing_template_value_is_an_error_not_a_blank():
    with pytest.raises(Exception):
        email_service.render("student_welcome", {"full_name": "Jane"})


def test_failed_send_is_logged(monkeypatch):
    fake_db = MagicMock()
    monkeypatch.setattr(email_service, "service_client", lambda: fake_db)
    monkeypatch.setattr(email_service, "_deliver", MagicMock(side_effect=OSError("SMTP down")))
    ok = email_service.send_now("password_changed", "a@b.com", {"full_name": "A", "changed_at": "now"}, "u1")
    assert ok is False
    row = fake_db.table.return_value.insert.call_args.args[0]
    assert row["status"] == "failed" and "SMTP down" in row["error"] and row["related_user_id"] == "u1"


def test_email_log_never_contains_the_password(monkeypatch):
    fake_db = MagicMock()
    monkeypatch.setattr(email_service, "service_client", lambda: fake_db)
    monkeypatch.setattr(email_service, "_deliver", MagicMock())
    email_service.send_now("student_welcome", "j@x.com", {
        "full_name": "J", "reg_number": "AIU-2026-0009", "email": "j@x.com", "password": "Secret#999",
    })
    assert "Secret#999" not in str(fake_db.table.return_value.insert.call_args)


@pytest.mark.parametrize("raw,expected", [
    ("jane", "jane"), ("a,b(c)*", "a b c"), ("  x%y ", "x y"), ("AIU-2026-0001", "AIU-2026-0001"),
])
def test_search_term_sanitised(raw, expected):
    assert " ".join(user_service._search_term(raw).split()) == expected


@pytest.mark.parametrize("value,ok", [("3f0c1b1e-8a2c-4d6e-9b1a-2c3d4e5f6a7b", True), ("not-a-uuid", False), ("", False), (None, False)])
def test_is_valid_uuid(value, ok):
    assert user_service.is_valid_uuid(value) is ok


@pytest.mark.parametrize("address,reserved", [
    ("john@example.com", True), ("a@sub.test", True), ("x@EXAMPLE.ORG", True), ("demo@demo.example.org", True),
    ("eg8217178@gmail.com", False), ("student@aiu.edu", False), ("x@notexample.org", False),
])
def test_reserved_test_addresses_are_never_sent(address, reserved):
    assert email_service._is_reserved_test_address(address) is reserved


# ------------------------------------------------------------------ relay mode (Supabase Edge Function)

def _relay_settings(monkeypatch, key="relay-secret"):
    s = email_service.get_settings()
    monkeypatch.setattr(s, "EMAIL_MODE", "relay")
    monkeypatch.setattr(s, "EMAIL_RELAY_KEY", email_service.get_settings().EMAIL_RELAY_KEY.__class__(key))
    monkeypatch.setattr(s, "EMAIL_RELAY_URL", "https://relay.test/functions/v1/send-email")
    return s


def test_relay_posts_the_rendered_email(monkeypatch):
    s = _relay_settings(monkeypatch)
    post = MagicMock(return_value=MagicMock(status_code=200))
    monkeypatch.setattr(email_service.httpx, "post", post)
    email = email_service.RenderedEmail(subject="Hello", html="<p>Hi</p>", text="Hi")
    email_service._deliver("real.person@gmail.com", email)
    url, kwargs = post.call_args.args[0], post.call_args.kwargs
    assert url == "https://relay.test/functions/v1/send-email"
    assert kwargs["headers"]["x-relay-key"] == "relay-secret"
    assert kwargs["headers"]["Authorization"] == f"Bearer {s.SUPABASE_ANON_KEY}"
    assert kwargs["json"] == {"to": "real.person@gmail.com", "subject": "Hello", "html": "<p>Hi</p>",
                              "text": "Hi", "from_name": s.EMAIL_FROM_NAME}


def test_relay_failure_raises_so_it_is_logged_as_failed(monkeypatch):
    _relay_settings(monkeypatch)
    bad = MagicMock(status_code=502, json=MagicMock(return_value={"ok": False, "error": "Invalid login"}))
    monkeypatch.setattr(email_service.httpx, "post", MagicMock(return_value=bad))
    with pytest.raises(RuntimeError, match="502: Invalid login"):
        email_service._deliver("real.person@gmail.com", email_service.RenderedEmail("S", "<p>x</p>", "x"))


def test_relay_without_key_refuses(monkeypatch):
    _relay_settings(monkeypatch, key="")
    post = MagicMock()
    monkeypatch.setattr(email_service.httpx, "post", post)
    with pytest.raises(RuntimeError, match="not configured"):
        email_service._deliver("real.person@gmail.com", email_service.RenderedEmail("S", "<p>x</p>", "x"))
    post.assert_not_called()


def test_relay_still_skips_reserved_test_addresses(monkeypatch):
    _relay_settings(monkeypatch)
    post = MagicMock()
    monkeypatch.setattr(email_service.httpx, "post", post)
    email_service._deliver("someone@example.com", email_service.RenderedEmail("S", "<p>x</p>", "x"))
    post.assert_not_called()
