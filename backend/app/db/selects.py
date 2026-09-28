"""Shared PostgREST select strings."""

# A profile row plus its department, in one query.
PROFILE_SELECT = "*, department:departments(id, name, code)"
