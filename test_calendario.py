"""Test dei fogli Codici e Calendario."""

from conftest import ANNO


def test_pomeriggio_dura_sette_ore(wb):
    ws = wb["Codici"]
    riga = {ws.cell(row=r, column=1).value: r for r in range(5, 10)}
    assert ws.cell(row=riga["P"], column=3).value == "13:00"
    assert ws.cell(row=riga["P"], column=4).value == "20:00"
    assert ws.cell(row=riga["P"], column=5).value == 7


def test_pomeriggio_lungo_dura_otto_ore(wb):
    ws = wb["Codici"]
    riga = {ws.cell(row=r, column=1).value: r for r in range(5, 10)}
    assert ws.cell(row=riga["P1"], column=3).value == "13:00"
    assert ws.cell(row=riga["P1"], column=4).value == "21:00"
    assert ws.cell(row=riga["P1"], column=5).value == 8


def test_codici_ha_la_colonna_orario(wb):
    ws = wb["Codici"]
    assert ws["F4"].value == "Orario"
    assert ws["F5"].value == '=IF(C5="","–",C5&"-"&D5)'
    assert ws["F9"].value == '=IF(C9="","–",C9&"-"&D9)'
