"""Simulated checkout rules and email rendering for finance."""

from datetime import date

import pytest

from app.services import email_service
from app.services.finance_rules import (
    DECLINE_CARD,
    PaymentDetailsError,
    amounts_differ,
    check_card,
    check_phone,
    is_declined,
    money,
)

TODAY = date(2026, 9, 27)


def test_any_16_digit_card_is_accepted_with_spaces():
    assert check_card("4242 4242 4242 4242", "12/28", "123", TODAY) == "4242424242424242"


@pytest.mark.parametrize("number,expiry,cvc,msg", [
    ("4242 4242 4242", "12/28", "123", "16-digit"),
    ("4242424242424242", "13/28", "123", "month"),
    ("4242424242424242", "08/26", "123", "expired"),
    ("4242424242424242", "12/28", "12", "security code"),
])
def test_bad_card_details(number, expiry, cvc, msg):
    with pytest.raises(PaymentDetailsError, match=msg):
        check_card(number, expiry, cvc, TODAY)


def test_card_expiring_this_month_is_still_valid():
    assert check_card("4242424242424242", "09/26", "123", TODAY)


def test_decline_test_card():
    assert is_declined(check_card("4000 0000 0000 0002", "12/28", "123", TODAY))
    assert DECLINE_CARD == "4000000000000002" and not is_declined("4242424242424242")


def test_mobile_money_phone():
    assert check_phone("+231 77 012 3456") == "231770123456"
    with pytest.raises(PaymentDetailsError):
        check_phone("12")


def test_money_formatting_and_amount_mismatch():
    assert money(4500, "USD") == "4,500.00 USD"
    assert amounts_differ(5000, 4500) and not amounts_differ(4500.0, "4500.00") and not amounts_differ(None, 4500)


def test_receipt_email_is_marked_simulated():
    e = email_service.render("payment_receipt", {
        "full_name": "Jane", "reference": "PAY-2026-000001", "invoice_number": "INV-2026-000001", "fee_name": "Tuition",
        "amount": "4,500.00 USD", "method": "Card", "paid_at": "27 September 2026", "reg_number": "AIU-2026-0001",
        "receipt_url": "http://x/r"})
    assert "SIMULATED PAYMENT" in e.text and "PAY-2026-000001" in e.html


def test_invoice_email():
    e = email_service.render("invoice_created", {"full_name": "Jane", "invoice_number": "INV-2026-000001",
                                                 "fee_name": "Tuition", "amount": "4,500.00 USD",
                                                 "due_date": "27 October 2026", "pay_url": "http://x/p"})
    assert "INV-2026-000001" in e.text and "27 October 2026" in e.text
