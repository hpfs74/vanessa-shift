"""Foglio Stipendio: simulazione del compenso mensile.

Le ore arrivano dal foglio Presenze. La tariffa e le maggiorazioni le scrive
l'utente nelle celle verdi: finche' sono vuote la tabella resta vuota.
"""

from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from comune import BLU_SCURO, BOX, GRIGIO_INT, MESI, festivi_italiani, intesta, riga_presenze

RIGA_PARAMETRI = 5
RIGA_TABELLA = 15          # intestazione della tabella mensile
RIGA_PRIMO_MESE = 16
RIGA_TOTALE = RIGA_PRIMO_MESE + 12      # 28
RIGA_CONTROLLO = RIGA_TOTALE + 2        # 30

COLONNE = ["Mese", "Ore ord.", "Ore sab", "Ore dom", "Ore fest",
           "Lordo base", "Magg. sab", "Magg. dom", "Magg. fest",
           "Rateo 13a", "Lordo totale", "Netto stimato"]


def _somma_righe(righe):
    """Somma esplicita di celle di Presenze, o 0 se non ce n'e' nessuna."""
    if not righe:
        return 0
    return "=" + "+".join(f"Presenze!$E${r}" for r in righe)


def foglio_stipendio(wb, anno, p_r1, p_r2):
    ws = wb.create_sheet("Stipendio")
    festivi = festivi_italiani(anno)
    ore = f"Presenze!$E${p_r1}:$E${p_r2}"
    mesi = f"Presenze!$C${p_r1}:$C${p_r2}"
    giorni = f"Presenze!$B${p_r1}:$B${p_r2}"

    intesta(ws, RIGA_TABELLA, COLONNE,
            larghezze=[14] + [10] * 4 + [13] * 7)

    for i, nome in enumerate(MESI):
        r = RIGA_PRIMO_MESE + i
        mese = i + 1
        del_mese = sorted(d for d in festivi if d.month == mese)
        r_fest = [riga_presenze(d, anno) for d in del_mese]
        r_fest_sab = [riga_presenze(d, anno) for d in del_mese if d.weekday() == 5]
        r_fest_dom = [riga_presenze(d, anno) for d in del_mese if d.weekday() == 6]

        ws.cell(row=r, column=1, value=nome).font = Font(bold=True)
        # Precedenza: festivo, poi domenica, poi sabato. Ogni ora una categoria sola.
        ws.cell(row=r, column=5, value=_somma_righe(r_fest))
        ws.cell(row=r, column=3, value=(
            f'=SUMIFS({ore},{mesi},$A{r},{giorni},"Sabato")'
            + "".join(f"-Presenze!$E${n}" for n in r_fest_sab)))
        ws.cell(row=r, column=4, value=(
            f'=SUMIFS({ore},{mesi},$A{r},{giorni},"Domenica")'
            + "".join(f"-Presenze!$E${n}" for n in r_fest_dom)))
        ws.cell(row=r, column=2, value=(
            f'=SUMIFS({ore},{mesi},$A{r})-C{r}-D{r}-E{r}'))

        for col in range(1, len(COLONNE) + 1):
            c = ws.cell(row=r, column=col)
            c.border = BOX
            if col > 1:
                c.alignment = Alignment(horizontal="center")
            if i % 2 == 0:
                c.fill = PatternFill("solid", fgColor=GRIGIO_INT)

    # Totale anno
    ws.cell(row=RIGA_TOTALE, column=1, value="TOTALE ANNO")
    for col in range(2, len(COLONNE) + 1):
        L = get_column_letter(col)
        ws.cell(row=RIGA_TOTALE, column=col,
                value=f"=SUM({L}{RIGA_PRIMO_MESE}:{L}{RIGA_TOTALE - 1})")
    for col in range(1, len(COLONNE) + 1):
        c = ws.cell(row=RIGA_TOTALE, column=col)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor=BLU_SCURO)
        c.border = BOX
        if col > 1:
            c.alignment = Alignment(horizontal="center")

    # Rete di sicurezza: B e' costruito per differenza (SUMIFS(mese)-C-D-E),
    # quindi B+C+D+E e' identicamente uguale a SUM(ore): un doppio conteggio
    # fra sabato/domenica/festivo non lo farebbe mai muovere da zero, non e'
    # un controllo vero. Un giorno contato due volte drena pero' le ore
    # ordinarie di quel mese, che possono scendere sotto zero: e' li' che si
    # vede davvero un difetto di ripartizione.
    ws.cell(row=RIGA_CONTROLLO, column=1,
            value="Controllo ore ordinarie (minimo mensile, deve essere >= 0)").font = Font(
        bold=True, color="B03030")
    c = ws.cell(row=RIGA_CONTROLLO, column=2,
                value=f"=MIN(B{RIGA_PRIMO_MESE}:B{RIGA_TOTALE - 1})")
    c.font = Font(bold=True, color="B03030")
    c.border = BOX
    c.alignment = Alignment(horizontal="center")
    ws.conditional_formatting.add(
        f"B{RIGA_CONTROLLO}",
        CellIsRule(operator="lessThan", formula=["0"],
                   font=Font(bold=True, color="FFFFFF"),
                   fill=PatternFill("solid", fgColor="B03030")))
    return ws
