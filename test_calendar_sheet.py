"""Tests for the Codici and Calendario sheets."""

from conftest import YEAR


def test_afternoon_is_seven_hours(wb):
    ws = wb["Codici"]
    row_of = {ws.cell(row=r, column=1).value: r for r in range(5, 10)}
    assert ws.cell(row=row_of["P"], column=3).value == "13:00"
    assert ws.cell(row=row_of["P"], column=4).value == "20:00"
    assert ws.cell(row=row_of["P"], column=5).value == 7


def test_long_afternoon_is_eight_hours(wb):
    ws = wb["Codici"]
    row_of = {ws.cell(row=r, column=1).value: r for r in range(5, 10)}
    assert ws.cell(row=row_of["P1"], column=3).value == "13:00"
    assert ws.cell(row=row_of["P1"], column=4).value == "21:00"
    assert ws.cell(row=row_of["P1"], column=5).value == 8


def test_codes_sheet_has_the_time_column(wb):
    ws = wb["Codici"]
    assert ws["F4"].value == "Orario"
    assert ws["F5"].value == '=IF(C5="","–",C5&"-"&D5)'
    assert ws["F9"].value == '=IF(C9="","–",C9&"-"&D9)'


def find_month_title(ws, text):
    """Row of a month block's title, e.g. 'GENNAIO 2026'."""
    for r in range(1, ws.max_row + 1):
        if ws.cell(row=r, column=1).value == text:
            return r
    raise AssertionError(f"block '{text}' not found")


def test_the_calendar_sheet_exists(wb):
    assert "Calendario" in wb.sheetnames


def test_there_are_twelve_month_blocks(wb):
    ws = wb["Calendario"]
    titles = [ws.cell(row=r, column=1).value for r in range(1, ws.max_row + 1)]
    blocks = [t for t in titles if isinstance(t, str) and t.endswith(f" {YEAR}")
               and t.isupper()]
    assert len(blocks) == 12
    assert blocks[0] == f"GENNAIO {YEAR}"
    assert blocks[-1] == f"DICEMBRE {YEAR}"


def test_day_headings(wb):
    ws = wb["Calendario"]
    r = find_month_title(ws, f"GENNAIO {YEAR}") + 1
    expected = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom", "Ore"]
    assert [ws.cell(row=r, column=c).value for c in range(1, 9)] == expected


def test_1_january_2026_is_a_thursday(wb):
    # 1 January 2026 is a Thursday: fourth column, first three cells empty.
    ws = wb["Calendario"]
    number_row = find_month_title(ws, f"GENNAIO {YEAR}") + 2
    assert [ws.cell(row=number_row, column=c).value for c in range(1, 5)] == [None, None, None, 1]


def test_every_month_holds_all_its_days(wb):
    import calendar as cal
    ws = wb["Calendario"]
    for m in range(1, 13):
        name = f"{['GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO', 'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'][m - 1]} {YEAR}"
        r = find_month_title(ws, name) + 2
        seen = []
        while ws.cell(row=r, column=1).value != f"TOTALE {name.split()[0]}":
            seen += [ws.cell(row=r, column=c).value for c in range(1, 8)
                      if isinstance(ws.cell(row=r, column=c).value, int)]
            r += 3
        assert sorted(seen) == list(range(1, cal.monthrange(YEAR, m)[1] + 1)), name


def test_the_code_cell_points_at_the_right_rota_row(wb):
    # 15 March 2026 is the 73rd day of the year -> row 5 + 73 = 78 in Presenze.
    from datetime import date

    import common
    row = common.rota_row(date(YEAR, 3, 15), YEAR)
    assert row == 78

    ws = wb["Calendario"]
    r = find_month_title(ws, f"MARZO {YEAR}") + 2
    while True:
        cols = [c for c in range(1, 8) if ws.cell(row=r, column=c).value == 15]
        if cols:
            break
        r += 3
    col = cols[0]
    assert ws.cell(row=r + 1, column=col).value == (
        f'=IF(Presenze!$D${row}="","",Presenze!$D${row}'
        f'&IF(Presenze!$F${row}="","","*"))'
    )
    assert ws.cell(row=r + 2, column=col).value == (
        f'=IF(Presenze!$D${row}="","",'
        f'IFERROR(VLOOKUP(Presenze!$D${row},Codici!$A$5:$F$9,6,FALSE),""))'
    )


def test_weekly_hours_sum_only_that_months_days(wb):
    # The week of 30 March straddles April: in the March block it sums
    # Mon-Tue (rows 93-94), in the April one Wed-Sun (rows 95-99).
    ws = wb["Calendario"]

    def week_hour_formulas(month_name):
        r = find_month_title(ws, month_name) + 2
        formulas = []
        while not str(ws.cell(row=r, column=1).value or "").startswith("TOTALE"):
            formulas.append(ws.cell(row=r, column=8).value)
            r += 3
        return formulas

    assert "=IF(SUM(Presenze!$E$93:$E$94)=0,\"\",SUM(Presenze!$E$93:$E$94))" \
        in week_hour_formulas(f"MARZO {YEAR}")
    assert "=IF(SUM(Presenze!$E$95:$E$99)=0,\"\",SUM(Presenze!$E$95:$E$99))" \
        in week_hour_formulas(f"APRILE {YEAR}")


def test_month_total(wb):
    # January: rows 5..35 in Presenze.
    ws = wb["Calendario"]
    r = find_month_title(ws, f"GENNAIO {YEAR}")
    while ws.cell(row=r, column=1).value != "TOTALE GENNAIO":
        r += 1
    assert ws.cell(row=r, column=5).value == "Giorni"
    assert ws.cell(row=r, column=6).value == '=COUNTIF(Presenze!$E$5:$E$35,">0")'
    assert ws.cell(row=r, column=7).value == "Ore"
    assert ws.cell(row=r, column=8).value == "=SUM(Presenze!$E$5:$E$35)"


def fill_colour(cell):
    f = cell.fill
    return f.fgColor.rgb[-6:] if f and f.fgColor and f.fgColor.rgb else None


def test_day_kind_colours(wb):
    ws = wb["Calendario"]
    # 25 April 2026 is a Saturday and a holiday: the holiday wins.
    r = find_month_title(ws, f"APRILE {YEAR}") + 2
    while True:
        cols = [c for c in range(1, 8) if ws.cell(row=r, column=c).value == 25]
        if cols:
            break
        r += 3
    assert fill_colour(ws.cell(row=r, column=cols[0])) == "FAE6B8"
    # 26 April is a plain Sunday.
    assert fill_colour(ws.cell(row=r, column=7)) == "F3DCE4"
    # 24 April is an ordinary Friday.
    assert fill_colour(ws.cell(row=r, column=5)) == "FFFFFF"


def test_easter_monday_is_a_holiday(wb):
    # 6 April 2026, Easter Monday.
    ws = wb["Calendario"]
    r = find_month_title(ws, f"APRILE {YEAR}") + 2
    while True:
        cols = [c for c in range(1, 8) if ws.cell(row=r, column=c).value == 6]
        if cols:
            break
        r += 3
    assert fill_colour(ws.cell(row=r, column=cols[0])) == "FAE6B8"


def test_cells_outside_the_month_are_grey(wb):
    ws = wb["Calendario"]
    r = find_month_title(ws, f"GENNAIO {YEAR}") + 2
    for c in range(1, 4):  # Mon, Tue, Wed before Thursday 1 January
        assert fill_colour(ws.cell(row=r, column=c)) == "F7F9FB"


def test_colour_rules_for_every_code(wb):
    ws = wb["Calendario"]
    formulas = set()
    for area in ws.conditional_formatting:
        for rule in area.rules:
            formulas.update(rule.formula)
    for code in ("L", "M", "M1", "P", "P1"):
        assert f'"{code}"' in formulas, code
        assert f'"{code}*"' in formulas, code
    for time_text in ("07:00-13:00", "07:00-14:00", "13:00-20:00", "13:00-21:00", "–"):
        assert f'"{time_text}"' in formulas, time_text


def test_colour_rules_cover_every_row_holding_a_formula(wb):
    # test_colour_rules_for_every_code only checks that the expected formulas
    # exist somewhere in the set: it would not notice a month block left out
    # of the conditional-formatting areas, nor an area shifted by one row.
    # Here the rows actually covered by the areas are compared against the
    # rows that really hold a code or time formula, read from the sheet
    # rather than hardcoded, so the test stays valid for any year.
    # The comparison is per row and not per cell because every area covers
    # the whole A:G row, including the weeks straddling two months where some
    # columns of that row hold no formula (days outside the month): that is
    # not a defect, it is how the areas are built.
    from openpyxl.utils.cell import range_boundaries

    ws = wb["Calendario"]

    def is_code_formula(v):
        return (isinstance(v, str) and v.startswith("=IF(Presenze!$D$")
                and "&IF(Presenze!$F$" in v)

    def is_time_formula(v):
        return (isinstance(v, str) and v.startswith("=IF(Presenze!$D$")
                and "VLOOKUP" in v)

    expected_rows = set()
    for r in range(1, ws.max_row + 1):
        for c in range(1, 8):  # columns A..G, where the days live
            v = ws.cell(row=r, column=c).value
            if is_code_formula(v) or is_time_formula(v):
                expected_rows.add(r)
                break
    assert expected_rows, "no row holds a formula: the test would assert nothing"

    covered_rows = set()
    for area in ws.conditional_formatting:
        for piece in str(area.sqref).split():
            _min_col, min_row, _max_col, max_row = range_boundaries(piece)
            covered_rows.update(range(min_row, max_row + 1))

    missing = expected_rows - covered_rows
    extra = covered_rows - expected_rows
    assert not missing, f"righe con formula non coperte da nessuna regola: {sorted(mancanti)}"
    assert not extra, f"regole su righe che non hanno nessuna formula: {sorted(in_piu)}"


def test_legend(wb):
    ws = wb["Calendario"]
    assert ws["A1"].value == f"Calendario {YEAR}"
    texts = [ws.cell(row=r, column=c).value
             for r in range(1, 10) for c in range(1, 9)]
    assert "Sabato" in texts
    assert "Domenica" in texts
    assert "Festivo" in texts
    assert any(isinstance(t, str) and t.startswith("* accanto al codice") for t in texts)
