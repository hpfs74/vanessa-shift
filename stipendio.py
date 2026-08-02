"""Foglio Stipendio: simulazione del compenso mensile.

Le ore arrivano dal foglio Presenze. La tariffa e le maggiorazioni le scrive
l'utente nelle celle verdi: finche' sono vuote la tabella resta vuota.
"""

from openpyxl.chart import BarChart, Reference
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from comune import (BLU_SCURO, BOX, GRIGIO_INT, MESI, VERDE, festivi_italiani,
                    intesta, riga_presenze, titolo)

RIGA_PARAMETRI = 5
RIGA_TABELLA = 15          # intestazione della tabella mensile
RIGA_PRIMO_MESE = 16
RIGA_TOTALE = RIGA_PRIMO_MESE + 12      # 28
RIGA_CONTROLLO = RIGA_TOTALE + 2        # 30

COLONNE = ["Mese", "Ore ord.", "Ore sab", "Ore dom", "Ore fest",
           "Lordo base", "Magg. sab", "Magg. dom", "Magg. fest",
           "Rateo 13a", "Lordo totale", "Netto stimato"]

PARAMETRI = [
    ("Tariffa oraria lorda", "€ #,##0.00"),
    ("Maggiorazione sabato", "0.00%"),
    ("Maggiorazione domenica", "0.00%"),
    ("Maggiorazione festivo", "0.00%"),
    ("Rateo 13a", "0.00%"),
    ("Coefficiente netto/lordo", "0.00%"),
]


def _parametri(ws, anno):
    """Righe 1-13: le celle da compilare a mano e le avvertenze."""
    titolo(ws, "A1", f"Simulazione stipendio {anno}")
    ws["A2"] = ("Compila le celle verdi: la tabella qui sotto si calcola da sola. "
                "CCNL Cooperative Sociali, OSS livello C1.")
    ws["A2"].font = Font(italic=True, size=10, color="5A6B7D")

    intesta(ws, 4, ["Parametro", "Valore"])
    for i, (etichetta, formato) in enumerate(PARAMETRI):
        r = 5 + i
        e = ws.cell(row=r, column=1, value=etichetta)
        e.font = Font(bold=True)
        e.border = BOX
        c = ws.cell(row=r, column=2)
        # Il rateo e' l'unico con un valore di partenza sensato: 1/12 del lordo.
        c.value = "=1/12" if etichetta == "Rateo 13a" else None
        c.number_format = formato
        c.fill = PatternFill("solid", fgColor=VERDE)
        c.alignment = Alignment(horizontal="center")
        c.border = BOX

    ws["A12"] = ("La tariffa oraria si legge sul contratto o sulla busta paga. "
                 "Il coefficiente netto/lordo si ottiene dividendo il netto di una "
                 "busta paga vera per il suo lordo.")
    ws["A12"].font = Font(italic=True, size=10, color="5A6B7D")
    ws["A13"] = ("Non calcola: straordinari, notturno, scatti di anzianita', TFR, "
                 "conguagli, addizionali regionali e comunali.")
    ws["A13"].font = Font(italic=True, size=10, color="5A6B7D")


def _somma_righe(righe):
    """Somma esplicita di celle di Presenze, o 0 se non ce n'e' nessuna."""
    if not righe:
        return 0
    return "=" + "+".join(f"Presenze!$E${r}" for r in righe)


def foglio_stipendio(wb, anno, p_r1, p_r2):
    ws = wb.create_sheet("Stipendio")
    _parametri(ws, anno)
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

        # Tutte le ore al lordo base, poi le maggiorazioni solo su sab/dom/fest.
        # Ogni maggiorazione resta vuota finche' non e' impostata la sua percentuale,
        # non solo la tariffa: altrimenti "vuoto * numero" da' 0, un'altra cifra
        # che sembra un risultato e invece e' solo un parametro mancante.
        ws.cell(row=r, column=6, value=f'=IF($B$5="","",(B{r}+C{r}+D{r}+E{r})*$B$5)')
        ws.cell(row=r, column=7, value=f'=IF(OR($B$5="",$B$6=""),"",C{r}*$B$5*$B$6)')
        ws.cell(row=r, column=8, value=f'=IF(OR($B$5="",$B$7=""),"",D{r}*$B$5*$B$7)')
        ws.cell(row=r, column=9, value=f'=IF(OR($B$5="",$B$8=""),"",E{r}*$B$5*$B$8)')
        # Il rateo e il lordo totale sommano colonne che possono essere vuote
        # (testo ""), non zero: "vuoto"+numero darebbe #VALUE!, quindi ciascuno
        # controlla che gli addendi a monte siano gia' risolti prima di sommarli.
        # G/H/I vuote significano gia' "manca B5, B6, B7 o B8": basta controllare
        # loro, non serve ripetere i parametri.
        ws.cell(row=r, column=10, value=(
            f'=IF(OR(G{r}="",H{r}="",I{r}="",$B$9=""),"",(F{r}+G{r}+H{r}+I{r})*$B$9)'))
        ws.cell(row=r, column=11, value=f'=IF(J{r}="","",F{r}+G{r}+H{r}+I{r}+J{r})')
        ws.cell(row=r, column=12, value=f'=IF(OR(K{r}="",$B$10=""),"",K{r}*$B$10)')
        for col in range(6, 13):
            ws.cell(row=r, column=col).number_format = '€ #,##0.00'

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
        intervallo = f"{L}{RIGA_PRIMO_MESE}:{L}{RIGA_TOTALE - 1}"
        if col >= 6:
            # SUM ignora le celle di testo "" e darebbe 0 su un anno non
            # ancora configurato: un totale di zero euro che sembra un
            # risultato vero. Il mese di gennaio fa da sentinella: se e'
            # vuoto lo sono anche gli altri undici, stesso interruttore.
            value = f'=IF({L}{RIGA_PRIMO_MESE}="","",SUM({intervallo}))'
        else:
            value = f"=SUM({intervallo})"
        ws.cell(row=RIGA_TOTALE, column=col, value=value)
    for col in range(1, len(COLONNE) + 1):
        c = ws.cell(row=RIGA_TOTALE, column=col)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor=BLU_SCURO)
        c.border = BOX
        if col > 1:
            c.alignment = Alignment(horizontal="center")
        if col >= 6:
            c.number_format = '€ #,##0.00'

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

    ch = BarChart()
    ch.type = "col"
    ch.title = "Lordo e netto stimato per mese"
    ch.height, ch.width = 9, 18
    ch.y_axis.title = "Euro"
    ch.add_data(Reference(ws, min_col=11, max_col=12,
                          min_row=RIGA_TABELLA, max_row=RIGA_TOTALE - 1),
                titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=1,
                                min_row=RIGA_PRIMO_MESE, max_row=RIGA_TOTALE - 1))
    ws.add_chart(ch, "N4")
    return ws
