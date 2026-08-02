"""Test delle funzioni di calendario in comune.py."""

from datetime import date

import comune


def test_pasqua_2026_e_il_5_aprile():
    assert comune.pasqua(2026) == date(2026, 4, 5)


def test_pasqua_2024_e_il_31_marzo():
    assert comune.pasqua(2024) == date(2024, 3, 31)


def test_pasqua_2011_e_il_24_aprile():
    assert comune.pasqua(2011) == date(2011, 4, 24)


def test_festivi_2026_sono_undici():
    festivi = comune.festivi_italiani(2026)
    assert len(festivi) == 11
    assert festivi[date(2026, 4, 6)] == "Lunedi dell'Angelo"
    assert festivi[date(2026, 12, 26)] == "Santo Stefano"
    assert date(2026, 8, 15) in festivi


def test_quando_pasquetta_cade_il_25_aprile_non_si_conta_due_volte():
    # Nel 2011 la Pasqua e' il 24 aprile: la Pasquetta coincide con la Liberazione.
    festivi = comune.festivi_italiani(2011)
    assert len(festivi) == 10
    assert festivi[date(2011, 4, 25)] == "Liberazione"


def test_riga_presenze_parte_da_cinque():
    assert comune.riga_presenze(date(2026, 1, 1), 2026) == 5
    assert comune.riga_presenze(date(2026, 1, 2), 2026) == 6
    assert comune.riga_presenze(date(2026, 12, 31), 2026) == 369


def test_riga_presenze_su_anno_bisestile():
    assert comune.riga_presenze(date(2024, 12, 31), 2024) == 370


def test_orario_di():
    assert comune.orario_di(("M", "Mattina", "07:00", "13:00", 6)) == "07:00-13:00"
    assert comune.orario_di(("L", "Libero", "", "", 0)) == "–"
