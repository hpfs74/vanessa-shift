"""Foglio Calendario: dodici mini-calendari mensili, in sola lettura.

Ogni cella e' una formula che punta alla riga del foglio Presenze di quel
giorno. Qui non si scrive niente: i turni si inseriscono in Presenze.
"""

import calendar
from datetime import date

from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from comune import BLU_SCURO, BOX, MESI, riga_presenze

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


def _blocco_mese(ws, riga, anno, mese, lookup):
    """Scrive il blocco di un mese. Restituisce la prima riga libera dopo."""
    nome = MESI[mese - 1].upper()
    ws.cell(row=riga, column=1, value=f"{nome} {anno}").font = Font(
        bold=True, size=13, color=BLU_SCURO)
    ws.merge_cells(start_row=riga, start_column=1, end_row=riga, end_column=COL_ORE)
    ws.row_dimensions[riga].height = 22

    _intestazione_blocco(ws, riga + 1)
    r = riga + 2

    for settimana in calendar.Calendar(firstweekday=0).monthdatescalendar(anno, mese):
        del_mese = [d for d in settimana if d.month == mese]
        for i, d in enumerate(settimana, start=1):
            if d.month != mese:
                continue
            rp = riga_presenze(d, anno)
            n = ws.cell(row=r, column=i, value=d.day)
            n.font = Font(bold=True, size=11)
            # L'asterisco segnala che quel turno e' stato scambiato con una collega.
            cod = ws.cell(row=r + 1, column=i, value=(
                f'=IF(Presenze!$D${rp}="","",Presenze!$D${rp}'
                f'&IF(Presenze!$F${rp}="","","*"))'))
            cod.font = Font(bold=True, size=12)
            ora = ws.cell(row=r + 2, column=i, value=(
                f'=IF(Presenze!$D${rp}="","",'
                f'IFERROR(VLOOKUP(Presenze!$D${rp},{lookup},6,FALSE),""))'))
            ora.font = Font(size=9, color="5A6B7D")

        # I giorni del mese dentro una settimana sono righe contigue in Presenze.
        r1 = riga_presenze(del_mese[0], anno)
        r2 = riga_presenze(del_mese[-1], anno)
        somma = f"SUM(Presenze!$E${r1}:$E${r2})"
        ore = ws.cell(row=r, column=COL_ORE, value=f'=IF({somma}=0,"",{somma})')
        ore.font = Font(bold=True, color=BLU_SCURO)
        ws.merge_cells(start_row=r, start_column=COL_ORE,
                       end_row=r + 2, end_column=COL_ORE)

        for rr, altezza in ((r, 18), (r + 1, 20), (r + 2, 15)):
            ws.row_dimensions[rr].height = altezza
            for i in range(1, COL_ORE + 1):
                c = ws.cell(row=rr, column=i)
                c.border = BOX
                c.alignment = Alignment(horizontal="center", vertical="center")
        r += 3

    primo = riga_presenze(date(anno, mese, 1), anno)
    ultimo = riga_presenze(date(anno, mese, calendar.monthrange(anno, mese)[1]), anno)
    ws.cell(row=r, column=1, value=f"TOTALE {nome}").font = Font(bold=True, color=BLU_SCURO)
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=4)
    ws.cell(row=r, column=5, value="Giorni")
    ws.cell(row=r, column=6, value=f'=COUNTIF(Presenze!$E${primo}:$E${ultimo},">0")')
    ws.cell(row=r, column=7, value="Ore")
    ws.cell(row=r, column=COL_ORE, value=f"=SUM(Presenze!$E${primo}:$E${ultimo})")
    for i in range(5, COL_ORE + 1):
        c = ws.cell(row=r, column=i)
        c.font = Font(bold=True, color=BLU_SCURO)
        c.alignment = Alignment(horizontal="center")
        c.border = BOX
    return r + 2  # una riga vuota fra un mese e l'altro


def foglio_calendario(wb, anno, cod_r1, cod_r2):
    """Crea il foglio Calendario. cod_r1/cod_r2 sono le righe dati del foglio Codici."""
    ws = wb.create_sheet("Calendario")
    for col in range(1, COL_ORE):
        ws.column_dimensions[get_column_letter(col)].width = 13
    ws.column_dimensions[get_column_letter(COL_ORE)].width = 9

    lookup = f"Codici!$A${cod_r1}:$F${cod_r2}"
    r = PRIMA_RIGA_BLOCCHI
    for mese in range(1, 13):
        r = _blocco_mese(ws, r, anno, mese, lookup)
    return ws
