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


def test_la_cella_codice_punta_alla_riga_giusta_di_presenze(wb):
    # 15 marzo 2026 = 73esimo giorno dell'anno -> riga 5 + 73 = 78 in Presenze.
    from datetime import date

    import comune
    riga = comune.riga_presenze(date(ANNO, 3, 15), ANNO)
    assert riga == 78

    ws = wb["Calendario"]
    r = trova_titolo_mese(ws, f"MARZO {ANNO}") + 2
    while True:
        colonne = [c for c in range(1, 8) if ws.cell(row=r, column=c).value == 15]
        if colonne:
            break
        r += 3
    col = colonne[0]
    assert ws.cell(row=r + 1, column=col).value == (
        f'=IF(Presenze!$D${riga}="","",Presenze!$D${riga}'
        f'&IF(Presenze!$F${riga}="","","*"))'
    )
    assert ws.cell(row=r + 2, column=col).value == (
        f'=IF(Presenze!$D${riga}="","",'
        f'IFERROR(VLOOKUP(Presenze!$D${riga},Codici!$A$5:$F$9,6,FALSE),""))'
    )


def test_le_ore_della_settimana_sommano_solo_i_giorni_del_mese(wb):
    # La settimana del 30 marzo va a cavallo con aprile: nel blocco di marzo
    # somma lun-mar (righe 93-94), in quello di aprile mer-dom (righe 95-99).
    ws = wb["Calendario"]

    def ore_delle_settimane(nome_mese):
        r = trova_titolo_mese(ws, nome_mese) + 2
        formule = []
        while not str(ws.cell(row=r, column=1).value or "").startswith("TOTALE"):
            formule.append(ws.cell(row=r, column=8).value)
            r += 3
        return formule

    assert "=IF(SUM(Presenze!$E$93:$E$94)=0,\"\",SUM(Presenze!$E$93:$E$94))" \
        in ore_delle_settimane(f"MARZO {ANNO}")
    assert "=IF(SUM(Presenze!$E$95:$E$99)=0,\"\",SUM(Presenze!$E$95:$E$99))" \
        in ore_delle_settimane(f"APRILE {ANNO}")


def test_totale_del_mese(wb):
    # Gennaio: righe 5..35 in Presenze.
    ws = wb["Calendario"]
    r = trova_titolo_mese(ws, f"GENNAIO {ANNO}")
    while ws.cell(row=r, column=1).value != "TOTALE GENNAIO":
        r += 1
    assert ws.cell(row=r, column=5).value == "Giorni"
    assert ws.cell(row=r, column=6).value == '=COUNTIF(Presenze!$E$5:$E$35,">0")'
    assert ws.cell(row=r, column=7).value == "Ore"
    assert ws.cell(row=r, column=8).value == "=SUM(Presenze!$E$5:$E$35)"


def colore(cella):
    f = cella.fill
    return f.fgColor.rgb[-6:] if f and f.fgColor and f.fgColor.rgb else None


def test_colori_dei_tipi_di_giorno(wb):
    ws = wb["Calendario"]
    # 25 aprile 2026 e' un sabato ed e' festivo: vince il festivo.
    r = trova_titolo_mese(ws, f"APRILE {ANNO}") + 2
    while True:
        cols = [c for c in range(1, 8) if ws.cell(row=r, column=c).value == 25]
        if cols:
            break
        r += 3
    assert colore(ws.cell(row=r, column=cols[0])) == "FAE6B8"
    # 26 aprile e' domenica non festiva.
    assert colore(ws.cell(row=r, column=7)) == "F3DCE4"
    # 24 aprile e' un venerdi feriale.
    assert colore(ws.cell(row=r, column=5)) == "FFFFFF"


def test_pasquetta_e_festiva(wb):
    # 6 aprile 2026, lunedi dell'Angelo.
    ws = wb["Calendario"]
    r = trova_titolo_mese(ws, f"APRILE {ANNO}") + 2
    while True:
        cols = [c for c in range(1, 8) if ws.cell(row=r, column=c).value == 6]
        if cols:
            break
        r += 3
    assert colore(ws.cell(row=r, column=cols[0])) == "FAE6B8"


def test_caselle_fuori_mese_sono_grigie(wb):
    ws = wb["Calendario"]
    r = trova_titolo_mese(ws, f"GENNAIO {ANNO}") + 2
    for c in range(1, 4):  # lun, mar, mer prima del giovedi 1 gennaio
        assert colore(ws.cell(row=r, column=c)) == "F7F9FB"


def test_regole_di_colore_per_ogni_codice(wb):
    ws = wb["Calendario"]
    formule = set()
    for intervallo in ws.conditional_formatting:
        for regola in intervallo.rules:
            formule.update(regola.formula)
    for cod in ("L", "M", "M1", "P", "P1"):
        assert f'"{cod}"' in formule, cod
        assert f'"{cod}*"' in formule, cod
    for orario in ("07:00-13:00", "07:00-14:00", "13:00-20:00", "13:00-21:00", "–"):
        assert f'"{orario}"' in formule, orario


def test_legenda(wb):
    ws = wb["Calendario"]
    assert ws["A1"].value == f"Calendario {ANNO}"
    testi = [ws.cell(row=r, column=c).value
             for r in range(1, 10) for c in range(1, 9)]
    assert "Sabato" in testi
    assert "Domenica" in testi
    assert "Festivo" in testi
    assert any(isinstance(t, str) and t.startswith("* accanto al codice") for t in testi)
