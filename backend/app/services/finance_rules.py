"""Pure rules for the simulated checkout and fee matching (no I/O - unit tested)."""

import re
from datetime import date
from decimal import Decimal

# Spec 12.3: this test card always simulates a DECLINED payment.
DECLINE_CARD = "4000000000000002"


class PaymentDetailsError(ValueError):
    """Invalid (fake) payment details; the message is shown to the user."""


def digits(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def check_card(number: str, expiry: str, cvc: str, today: date | None = None) -> str:
    """Validate the fake card's FORMAT (any 16-digit number is accepted, as in the spec).
    Returns the clean 16-digit number. Raises PaymentDetailsError."""
    today = today or date.today()
    n = digits(number)
    if len(n) != 16:
        raise PaymentDetailsError("Enter a 16-digit card number.")
    mm, yy = (int(p) for p in expiry.replace(" ", "").split("/"))
    if not 1 <= mm <= 12:
        raise PaymentDetailsError("The expiry month must be between 01 and 12.")
    if (2000 + yy, mm) < (today.year, today.month):
        raise PaymentDetailsError("This card has expired.")
    if not re.fullmatch(r"\d{3,4}", cvc or ""):
        raise PaymentDetailsError("Enter the 3-digit security code.")
    return n


def check_phone(phone: str | None) -> str:
    p = digits(phone or "")
    if not 7 <= len(p) <= 15:
        raise PaymentDetailsError("Enter a valid mobile money phone number.")
    return p


def is_declined(card_number: str | None) -> bool:
    return card_number == DECLINE_CARD


def money(amount: float | Decimal | str, currency: str = "USD") -> str:
    """'4,500.00 USD'."""
    return f"{Decimal(str(amount)):,.2f} {currency}"


def amounts_differ(stated: Decimal | float | None, official: Decimal | float) -> bool:
    return stated is not None and Decimal(str(stated)).quantize(Decimal("0.01")) != Decimal(str(official)).quantize(Decimal("0.01"))
