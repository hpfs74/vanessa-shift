"""Foglio Calendario: dodici mini-calendari mensili, in sola lettura.

Ogni cella e' una formula che punta alla riga del foglio Presenze di quel
giorno. Qui non si scrive niente: i turni si inseriscono in Presenze.
"""

import calendar

from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from comune import BLU_SCURO, BOX, MESI

GIORNI_BREVI = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"]

COL_ORE = 8              # colonna H, il totale ore della settimana
PRIMA_RIGA_BLOCCHI = 10  # sopra c'e' la legenda


def _intestazione_blocco(ws, riga):
    """Riga scura Lun..Dom + Ore."""
    for i, v in enumerate(GIORNI_BREVI + ["Ore"], start=1):
        c = ws.cell(row=riga, column=i, value=v)
        c.font = Font(bold=True, color="FFFFFF", size=10)
        c.fill = PatternFill("solid", fgColor=BLU_SCURO)
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border = BOX
    ws.row_dimensions[riga].height = 20


def _blocco_mese(ws, riga, anno, mese):
    """Scrive il blocco di un mese. Restituisce la prima riga libera dopo."""
    nome = MESI[mese - 1].upper()
    ws.cell(row=riga, column=1, value=f"{nome} {anno}").font = Font(
        bold=True, size=13, color=BLU_SCURO)
    ws.merge_cells(start_row=riga, start_column=1, end_row=riga, end_column=COL_ORE)
    ws.row_dimensions[riga].height = 22

    _intestazione_blocco(ws, riga + 1)
    r = riga + 2

    for settimana in calendar.Calendar(firstweekday=0).monthdatescalendar(anno, mese):
        for i, d in enumerate(settimana, start=1):
            if d.month != mese:
                continue
            n = ws.cell(row=r, column=i, value=d.day)
            n.font = Font(bold=True, size=11)
            n.alignment = Alignment(horizontal="center", vertical="center")
        for rr, altezza in ((r, 18), (r + 1, 20), (r + 2, 15)):
            ws.row_dimensions[rr].height = altezza
            for i in range(1, COL_ORE + 1):
                ws.cell(row=rr, column=i).border = BOX
        r += 3

    ws.cell(row=r, column=1, value=f"TOTALE {nome}").font = Font(bold=True, color=BLU_SCURO)
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=4)
    return r + 2  # una riga vuota fra un mese e l'altro


def foglio_calendario(wb, anno, cod_r1, cod_r2):
    """Crea il foglio Calendario. cod_r1/cod_r2 sono le righe dati del foglio Codici."""
    ws = wb.create_sheet("Calendario")
    for col in range(1, COL_ORE):
        ws.column_dimensions[get_column_letter(col)].width = 13
    ws.column_dimensions[get_column_letter(COL_ORE)].width = 9

    r = PRIMA_RIGA_BLOCCHI
    for mese in range(1, 13):
        r = _blocco_mese(ws, r, anno, mese)
    return ws
