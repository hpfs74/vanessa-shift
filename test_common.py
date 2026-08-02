"""Tests for the calendar maths in common.py."""

from datetime import date

import common


def test_easter_2026_is_5_april():
    assert common.easter(2026) == date(2026, 4, 5)


def test_easter_2024_is_31_march():
    assert common.easter(2024) == date(2024, 3, 31)


def test_easter_2011_is_24_april():
    assert common.easter(2011) == date(2011, 4, 24)


def test_2026_has_eleven_holidays():
    holidays = common.italian_holidays(2026)
    assert len(holidays) == 11
    assert holidays[date(2026, 4, 6)] == "Lunedi dell'Angelo"
    assert holidays[date(2026, 12, 26)] == "Santo Stefano"
    assert date(2026, 8, 15) in holidays


def test_easter_monday_on_25_april_is_not_counted_twice():
    # In 2011 Easter falls on 24 April: Easter Monday coincides with Liberazione.
    holidays = common.italian_holidays(2011)
    assert len(holidays) == 10
    assert holidays[date(2011, 4, 25)] == "Liberazione"


def test_rota_row_starts_at_five():
    assert common.rota_row(date(2026, 1, 1), 2026) == 5
    assert common.rota_row(date(2026, 1, 2), 2026) == 6
    assert common.rota_row(date(2026, 12, 31), 2026) == 369


def test_rota_row_on_a_leap_year():
    assert common.rota_row(date(2024, 12, 31), 2024) == 370


def test_time_range():
    assert common.time_range(("M", "Mattina", "07:00", "13:00", 6)) == "07:00-13:00"
    assert common.time_range(("L", "Libero", "", "", 0)) == "–"
