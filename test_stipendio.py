"""Test del foglio Stipendio."""

from datetime import date

import comune
from conftest import ANNO

MESI_RIGHE = {m: 16 + i for i, m in enumerate(comune.MESI)}


def test_il_foglio_stipendio_esiste(wb):
    assert "Stipendio" in wb.sheetnames


def test_intestazione_della_tabella(wb):
    ws = wb["Stipendio"]
    attese = ["Mese", "Ore ord.", "Ore sab", "Ore dom", "Ore fest",
              "Lordo base", "Magg. sab", "Magg. dom", "Magg. fest",
              "Rateo 13a", "Lordo totale", "Netto stimato"]
    assert [ws.cell(row=15, column=c).value for c in range(1, 13)] == attese


def test_i_dodici_mesi_in_ordine(wb):
    ws = wb["Stipendio"]
    assert [ws.cell(row=r, column=1).value for r in range(16, 28)] == comune.MESI


def test_ore_festive_di_dicembre(wb):
    # Dicembre 2026 ha tre festivi: 8, 25 e 26.
    ws = wb["Stipendio"]
    righe = [comune.riga_presenze(date(ANNO, 12, g), ANNO) for g in (8, 25, 26)]
    atteso = "=" + "+".join(f"Presenze!$E${r}" for r in righe)
    assert ws.cell(row=MESI_RIGHE["Dicembre"], column=5).value == atteso


def test_mese_senza_festivi_ha_zero_ore_festive(wb):
    # Nel 2026 luglio, settembre e ottobre non hanno festivi nazionali.
    ws = wb["Stipendio"]
    for mese in ("Luglio", "Settembre", "Ottobre"):
        assert ws.cell(row=MESI_RIGHE[mese], column=5).value == 0, mese


def test_le_ore_di_sabato_scartano_i_festivi_di_sabato(wb):
    # 25 aprile 2026 e' sabato ed e' festivo: non deve stare fra le ore di sabato.
    ws = wb["Stipendio"]
    riga_25 = comune.riga_presenze(date(ANNO, 4, 25), ANNO)
    r = MESI_RIGHE["Aprile"]
    atteso = (f'=SUMIFS(Presenze!$E$5:$E$369,Presenze!$C$5:$C$369,$A{r},'
              f'Presenze!$B$5:$B$369,"Sabato")-Presenze!$E${riga_25}')
    assert ws.cell(row=r, column=3).value == atteso


def test_le_ore_di_domenica_scartano_i_festivi_di_domenica(wb):
    # 1 novembre 2026 (Ognissanti) cade di domenica.
    ws = wb["Stipendio"]
    riga_1 = comune.riga_presenze(date(ANNO, 11, 1), ANNO)
    r = MESI_RIGHE["Novembre"]
    atteso = (f'=SUMIFS(Presenze!$E$5:$E$369,Presenze!$C$5:$C$369,$A{r},'
              f'Presenze!$B$5:$B$369,"Domenica")-Presenze!$E${riga_1}')
    assert ws.cell(row=r, column=4).value == atteso


def test_ore_ordinarie_sono_il_resto(wb):
    ws = wb["Stipendio"]
    r = MESI_RIGHE["Gennaio"]
    assert ws.cell(row=r, column=2).value == (
        f'=SUMIFS(Presenze!$E$5:$E$369,Presenze!$C$5:$C$369,$A{r})'
        f'-C{r}-D{r}-E{r}')


def test_riga_di_controllo_confronta_con_le_ore_totali(wb):
    ws = wb["Stipendio"]
    assert ws.cell(row=30, column=1).value == "Controllo ripartizione ore (deve essere 0)"
    assert ws.cell(row=30, column=2).value == (
        "=B28+C28+D28+E28-SUM(Presenze!$E$5:$E$369)")
