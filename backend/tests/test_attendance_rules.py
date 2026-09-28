"""Attendance rules: class codes and fair percentage calculation."""

from datetime import datetime, timedelta, timezone

from app.services.attendance_rules import counts_for_student, is_low, new_class_code, percent

T0 = datetime(2026, 9, 1, 9, 0, tzinfo=timezone.utc)


def sess(i, status="closed", day=0):
    return {"id": f"s{i}", "opens_at": T0 + timedelta(days=day), "status": status}


def test_class_code_is_six_digits_and_varied():
    codes = {new_class_code() for _ in range(500)}
    assert all(len(c) == 6 and c.isdigit() for c in codes)
    assert len(codes) > 450  # effectively random


def test_basic_percentage():
    sessions = [sess(1, day=1), sess(2, day=2), sess(3, day=3), sess(4, day=4)]
    assert counts_for_student(sessions, T0, {"s1", "s2", "s3"}) == (3, 4)
    assert percent(3, 4) == 75.0


def test_sessions_before_enrollment_do_not_count_against_a_late_student():
    sessions = [sess(1, day=1), sess(2, day=2), sess(3, day=10)]
    enrolled_late = T0 + timedelta(days=5)
    assert counts_for_student(sessions, enrolled_late, set()) == (0, 1)


def test_open_session_only_counts_once_marked():
    sessions = [sess(1, day=1), sess(2, status="open", day=2)]
    assert counts_for_student(sessions, T0, set()) == (0, 1)          # not yet absent in an open session
    assert counts_for_student(sessions, T0, {"s2"}) == (1, 2)         # present counts immediately


def test_no_sessions_means_no_percentage_not_zero():
    assert percent(0, 0) is None and not is_low(None, 75)


def test_low_threshold():
    assert is_low(74.9, 75) and not is_low(75.0, 75)
