"""Generation of unique random default passwords (spec Section 8.1)."""

import secrets

# Look-alike characters (O/0, l/1/I) are excluded so emailed passwords are easy to type.
_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
_LOWER = "abcdefghijkmnopqrstuvwxyz"
_DIGITS = "23456789"
_SYMBOLS = "#@$%&*!?"


def generate_default_password(length: int = 10) -> str:
    """Return a random password with upper, lower, digits and exactly one symbol."""
    if length < 4:
        raise ValueError("length must be at least 4")
    chars = [
        secrets.choice(_UPPER),
        secrets.choice(_LOWER),
        secrets.choice(_DIGITS),
        secrets.choice(_SYMBOLS),
    ]
    pool = _UPPER + _LOWER + _DIGITS
    chars += [secrets.choice(pool) for _ in range(length - len(chars))]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)
