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


def trova_titolo_mese(ws, testo):
    """Riga del titolo di un blocco mensile, es. 'GENNAIO 2026'."""
    for r in range(1, ws.max_row + 1):
        if ws.cell(row=r, column=1).value == testo:
            return r
    raise AssertionError(f"blocco '{testo}' non trovato")


def test_il_foglio_calendario_esiste(wb):
    assert "Calendario" in wb.sheetnames


def test_ci_sono_dodici_blocchi_mensili(wb):
    ws = wb["Calendario"]
    titoli = [ws.cell(row=r, column=1).value for r in range(1, ws.max_row + 1)]
    blocchi = [t for t in titoli if isinstance(t, str) and t.endswith(f" {ANNO}")
               and t.isupper()]
    assert len(blocchi) == 12
    assert blocchi[0] == f"GENNAIO {ANNO}"
    assert blocchi[-1] == f"DICEMBRE {ANNO}"


def test_intestazione_dei_giorni(wb):
    ws = wb["Calendario"]
    r = trova_titolo_mese(ws, f"GENNAIO {ANNO}") + 1
    attese = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom", "Ore"]
    assert [ws.cell(row=r, column=c).value for c in range(1, 9)] == attese


def test_il_primo_gennaio_2026_e_giovedi(wb):
    # 1 gennaio 2026 cade di giovedi: quarta colonna, prime tre caselle vuote.
    ws = wb["Calendario"]
    r_num = trova_titolo_mese(ws, f"GENNAIO {ANNO}") + 2
    assert [ws.cell(row=r_num, column=c).value for c in range(1, 5)] == [None, None, None, 1]


def test_ogni_mese_ha_tutti_i_suoi_giorni(wb):
    import calendar as cal
    ws = wb["Calendario"]
    for m in range(1, 13):
        nome = f"{['GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO', 'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'][m - 1]} {ANNO}"
        r = trova_titolo_mese(ws, nome) + 2
        visti = []
        while ws.cell(row=r, column=1).value != f"TOTALE {nome.split()[0]}":
            visti += [ws.cell(row=r, column=c).value for c in range(1, 8)
                      if isinstance(ws.cell(row=r, column=c).value, int)]
            r += 3
        assert sorted(visti) == list(range(1, cal.monthrange(ANNO, m)[1] + 1)), nome
