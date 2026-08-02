# Calendario e Stipendio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere al workbook generato da `genera_presenze.py` un foglio `Calendario` con dodici mini-calendari mensili in sola lettura e un foglio `Stipendio` che simula il compenso mensile a partire da una tariffa oraria.

**Architecture:** Lo script monolitico viene diviso in quattro moduli (`comune.py`, `calendario.py`, `stipendio.py`, `genera_presenze.py`). I due fogli nuovi non contengono dati propri: ogni cella è una formula che punta alle righe del foglio `Presenze`, che resta l'unica fonte di verità. I riferimenti alle righe sono calcolati in Python al momento della generazione (`riga_presenze(d)`), non risolti con ricerche per data.

**Tech Stack:** Python 3, openpyxl, pytest. Nessuna dipendenza oltre a queste due.

## Global Constraints

- Il workbook si apre in **Numbers**, non in Excel. Vietati: tabelle strutturate, nomi definiti, formule di array, riferimenti a fogli con spazi nel nome.
- La formattazione condizionale deve essere **a valore** (`CellIsRule(operator="equal", ...)`), mai a formula: è la sola che Numbers importa in modo affidabile.
- I riferimenti a `Presenze` sono assoluti e calcolati a generazione (`Presenze!$D$47`), mai `VLOOKUP` su una data.
- Il file di output è `Presenze_Vanessa_2026.xlsx`, **sovrascritto**. I file `.numbers` non vengono letti né scritti da nessuna parte del programma.
- Codici turno: `L` 0h, `M` 07:00–13:00 6h, `M1` 07:00–14:00 7h, `P` 13:00–20:00 **7h**, `P1` 13:00–21:00 **8h**.
- Colori giorno: feriale `FFFFFF`, sabato `DCE9F5`, domenica `F3DCE4`, festivo `FAE6B8`, casella vuota `F7F9FB`.
- Colori turno: `M` `FFF4CC`, `M1` `FFE8A3`, `P` `FFE0C2`, `P1` `FFCFA0`, `L` `EDF1F5`.
- Palette esistente da non cambiare: `BLU_SCURO` `1F3A5F`, `GRIGIO_INT` `EDF1F5`, `AZZURRO` `DCE9F5`, `VERDE` `E8F3EA`.
- Precedenza nella ripartizione ore: **festivo > domenica > sabato**. Ogni ora ricade in esattamente una categoria.
- Il codice e i commenti sono in italiano senza accenti (come il codice esistente: `Lunedi`, `unica fonte di verita'`). Le stringhe scritte nel workbook possono avere gli accenti.
- I test girano con `.venv/bin/pytest` dalla radice del progetto.

---

## File Structure

| File | Responsabilità |
|------|----------------|
| `comune.py` | palette, `intesta()`, `titolo()`, `BOX`, `CODICI`, `TIPI_SCAMBIO`, `MESI`, `GIORNI`, `orario_di()`, `pasqua()`, `festivi_italiani()`, `riga_presenze()` |
| `calendario.py` | `foglio_calendario()` e i suoi helper privati |
| `stipendio.py` | `foglio_stipendio()` |
| `genera_presenze.py` | `main()` e i quattro fogli esistenti (Codici, Presenze, Riepilogo, Scambi) |
| `conftest.py` | fixture pytest che genera il workbook una volta sola e lo rilegge |
| `test_calendario.py` | test dei fogli Codici e Calendario |
| `test_stipendio.py` | test del foglio Stipendio |
| `requirements.txt`, `README.md` | setup |

**Nota sui test:** la spec parlava di un unico `test_calendario.py`. Si dividono in due file perché coprono due fogli indipendenti; il contenuto è quello elencato nella spec, senza tagli.

---

### Task 1: Ambiente, codici turno aggiornati, colonna Orario

Fonda l'ambiente di test e fa la prima modifica verificabile: gli orari del pomeriggio e la colonna `Orario` nel foglio `Codici`.

**Files:**
- Create: `requirements.txt`, `README.md`, `conftest.py`, `test_calendario.py`
- Modify: `genera_presenze.py:24-30` (tabella `CODICI`), `genera_presenze.py:73-91` (`foglio_codici`)

**Interfaces:**
- Consumes: niente
- Produces: `foglio_codici(wb) -> (ws, 5, 9)` invariata nella firma; il foglio `Codici` ha ora sei colonne, `F` è `Orario`. Fixture pytest `wb` (session-scoped) che restituisce un `openpyxl.Workbook` caricato dal file generato per l'anno 2026.

- [ ] **Step 1: Creare l'ambiente virtuale e i file di setup**

`openpyxl` non è installato nell'ambiente di sistema. Dalla radice del progetto:

```bash
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet openpyxl pytest
.venv/bin/python -c "import openpyxl, pytest; print(openpyxl.__version__, pytest.__version__)"
```

`requirements.txt`:

```
openpyxl>=3.1
pytest>=8.0
```

`README.md`:

````markdown
# Presenze Vanessa

Genera il foglio presenze annuale (.xlsx) da aprire in Numbers.

## Installazione

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Uso

```bash
.venv/bin/python genera_presenze.py 2026 Presenze_Vanessa_2026.xlsx
```

## Test

```bash
.venv/bin/pytest -v
```

## Fogli

- **Presenze** — la lista dei 365 giorni. E' l'unico foglio in cui si scrive.
- **Calendario** — dodici mini-calendari mensili, sola lettura.
- **Codici** — la tabella dei turni. Cambiando le ore qui si ricalcola tutto l'anno.
- **Riepilogo** — conteggi mensili e grafici a torta.
- **Scambi** — saldo dei favori con le colleghe.
- **Stipendio** — simulazione del compenso. I parametri vanno compilati a mano.
````

- [ ] **Step 2: Scrivere la fixture pytest**

`conftest.py`:

```python
"""Fixture condivise: il workbook si genera una volta sola per tutta la sessione."""

import subprocess
import sys
from pathlib import Path

import pytest
from openpyxl import load_workbook

ANNO = 2026
RADICE = Path(__file__).parent


@pytest.fixture(scope="session")
def wb(tmp_path_factory):
    """Genera il workbook in una cartella temporanea e lo rilegge con le formule."""
    out = tmp_path_factory.mktemp("xlsx") / "Presenze_test.xlsx"
    subprocess.run(
        [sys.executable, "genera_presenze.py", str(ANNO), str(out)],
        cwd=RADICE, check=True, capture_output=True,
    )
    return load_workbook(out)
```

- [ ] **Step 3: Scrivere i test che falliscono**

`test_calendario.py`:

```python
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
```

- [ ] **Step 4: Eseguire i test e verificare che falliscano**

Run: `.venv/bin/pytest test_calendario.py -v`

Expected: FAIL. `test_pomeriggio_dura_sette_ore` fallisce con `assert '19:00' == '20:00'`; `test_codici_ha_la_colonna_orario` fallisce con `assert None == 'Orario'`.

- [ ] **Step 5: Aggiornare la tabella CODICI**

In `genera_presenze.py`, sostituire le righe 24-30:

```python
CODICI = [
    ("L",  "Libero",            "",      "",      0),
    ("M",  "Mattina",           "07:00", "13:00", 6),
    ("M1", "Mattina lunga",     "07:00", "14:00", 7),
    ("P",  "Pomeriggio",        "13:00", "20:00", 7),
    ("P1", "Pomeriggio lungo",  "13:00", "21:00", 8),
]
```

- [ ] **Step 6: Aggiungere la colonna Orario a `foglio_codici`**

Sostituire il corpo di `foglio_codici` (righe 73-91) con:

```python
def foglio_codici(wb):
    ws = wb.create_sheet("Codici")
    titolo(ws, "A1", "Codici turno")
    ws["A2"] = "Modifica le ore qui: tutto l'anno si ricalcola da solo."
    ws["A2"].font = Font(italic=True, size=10, color="5A6B7D")

    intesta(ws, 4, ["Cod", "Descrizione", "Inizio", "Fine", "Ore", "Orario"],
            larghezze=[10, 22, 12, 12, 10, 16])
    for i, (cod, desc, ini, fin, ore) in enumerate(CODICI):
        r = 5 + i
        for col, val in enumerate([cod, desc, ini, fin, ore], start=1):
            c = ws.cell(row=r, column=col, value=val)
            c.border = BOX
            c.alignment = Alignment(horizontal="center" if col != 2 else "left")
        # Orario leggibile, usato dal foglio Calendario: si aggiorna se cambio Inizio/Fine.
        c = ws.cell(row=r, column=6, value=f'=IF(C{r}="","–",C{r}&"-"&D{r})')
        c.border = BOX
        c.alignment = Alignment(horizontal="center")
        ws.cell(row=r, column=1).font = Font(bold=True)
        if ore == 0:
            for col in range(1, 7):
                ws.cell(row=r, column=col).fill = PatternFill("solid", fgColor=GRIGIO_INT)
    return ws, 5, 4 + len(CODICI)  # foglio, prima riga dati, ultima riga dati
```

- [ ] **Step 7: Eseguire i test e verificare che passino**

Run: `.venv/bin/pytest test_calendario.py -v`

Expected: PASS, 3 test.

- [ ] **Step 8: Commit**

```bash
git add requirements.txt README.md conftest.py test_calendario.py genera_presenze.py
git commit -m "feat: orari pomeriggio aggiornati e colonna Orario nel foglio Codici"
```

---

### Task 2: Modulo `comune.py`

Estrae le parti condivise e aggiunge le due funzioni che servono ai fogli nuovi: i festivi italiani e la mappatura giorno → riga di `Presenze`.

**Files:**
- Create: `comune.py`, `test_comune.py`
- Modify: `genera_presenze.py:11-50` (import e costanti), `genera_presenze.py:53-91` (rimozione degli helper spostati)

**Interfaces:**
- Consumes: `CODICI` da Task 1
- Produces:
  - `pasqua(anno: int) -> date`
  - `festivi_italiani(anno: int) -> dict[date, str]`
  - `riga_presenze(d: date, anno: int) -> int`
  - `orario_di(voce: tuple) -> str` — riceve una voce di `CODICI`, restituisce `"07:00-13:00"` o `"–"`
  - le costanti `BLU_SCURO`, `GRIGIO_INT`, `AZZURRO`, `VERDE`, `BORDO`, `BOX`, `CODICI`, `TURNI_LAVORATI`, `TIPI_SCAMBIO`, `SEGNO_SCAMBIO`, `N_COLLEGHE`, `MESI`, `GIORNI` e le funzioni `intesta(ws, riga, valori, larghezze=None)`, `titolo(ws, cella, testo, size=16)`

- [ ] **Step 1: Scrivere i test che falliscono**

`test_comune.py`:

```python
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
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `.venv/bin/pytest test_comune.py -v`

Expected: FAIL con `ModuleNotFoundError: No module named 'comune'`.

- [ ] **Step 3: Creare `comune.py`**

```python
"""Costanti, stili e calcoli di calendario condivisi da tutti i fogli."""

from datetime import date, timedelta

from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# --- Codici turno: unica fonte di verita', il foglio "Codici" li ricopia ---
# (codice, descrizione, inizio, fine, ore)
CODICI = [
    ("L",  "Libero",            "",      "",      0),
    ("M",  "Mattina",           "07:00", "13:00", 6),
    ("M1", "Mattina lunga",     "07:00", "14:00", 7),
    ("P",  "Pomeriggio",        "13:00", "20:00", 7),
    ("P1", "Pomeriggio lungo",  "13:00", "21:00", 8),
]
# Fette della torta: solo i turni lavorati (Libero vale 0 ore, non comparirebbe)
TURNI_LAVORATI = [c for c in CODICI if c[4] > 0]

# Scambi turno. Il segno dice da che parte sta il favore:
#   +1 = la collega mi deve un favore, -1 = lo devo io, 0 = pari e patta.
TIPI_SCAMBIO = ["Ho coperto", "Mi ha coperto", "Scambio pari"]
SEGNO_SCAMBIO = {"Ho coperto": 1, "Mi ha coperto": -1, "Scambio pari": 0}
N_COLLEGHE = 10  # righe disponibili nell'elenco colleghe

MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
        "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"]
GIORNI = ["Lunedi", "Martedi", "Mercoledi", "Giovedi", "Venerdi", "Sabato", "Domenica"]

# --- Palette ---
BLU_SCURO = "1F3A5F"
GRIGIO_INT = "EDF1F5"   # righe feriali alternate / intestazioni secondarie
AZZURRO = "DCE9F5"      # weekend
VERDE = "E8F3EA"        # celle di input
BORDO = Side(style="thin", color="C3CDD8")
BOX = Border(left=BORDO, right=BORDO, top=BORDO, bottom=BORDO)

# Prima riga di dati del foglio Presenze (sotto titolo, nota e intestazione).
PRIMA_RIGA_PRESENZE = 5


def intesta(ws, riga, valori, larghezze=None):
    """Scrive una riga di intestazione in stile scuro."""
    for i, v in enumerate(valori, start=1):
        c = ws.cell(row=riga, column=i, value=v)
        c.font = Font(bold=True, color="FFFFFF", size=11)
        c.fill = PatternFill("solid", fgColor=BLU_SCURO)
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border = BOX
    ws.row_dimensions[riga].height = 24
    if larghezze:
        for i, w in enumerate(larghezze, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w


def titolo(ws, cella, testo, size=16):
    c = ws[cella]
    c.value = testo
    c.font = Font(bold=True, size=size, color=BLU_SCURO)


def orario_di(voce):
    """Da una voce di CODICI all'orario leggibile. Deve dare la stessa stringa
    della formula in Codici!F, perche' le regole di colore la confrontano."""
    _cod, _desc, ini, fin, _ore = voce
    return "–" if not ini else f"{ini}-{fin}"


def pasqua(anno):
    """Domenica di Pasqua, algoritmo gregoriano anonimo."""
    a = anno % 19
    b, c = divmod(anno, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    ell = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * ell) // 451
    mese, giorno = divmod(h + ell - 7 * m + 114, 31)
    return date(anno, mese, giorno + 1)


def festivi_italiani(anno):
    """Festivi nazionali italiani: data -> nome. Il patrono locale non c'e'."""
    festivi = {
        date(anno, 1, 1): "Capodanno",
        date(anno, 1, 6): "Epifania",
        date(anno, 4, 25): "Liberazione",
        date(anno, 5, 1): "Festa del Lavoro",
        date(anno, 6, 2): "Festa della Repubblica",
        date(anno, 8, 15): "Ferragosto",
        date(anno, 11, 1): "Ognissanti",
        date(anno, 12, 8): "Immacolata",
        date(anno, 12, 25): "Natale",
        date(anno, 12, 26): "Santo Stefano",
    }
    # Se la Pasquetta cade il 25 aprile e' un giorno solo, non due: tengo il nome fisso.
    festivi.setdefault(pasqua(anno) + timedelta(days=1), "Lunedi dell'Angelo")
    return festivi


def riga_presenze(d, anno):
    """Riga del foglio Presenze che ospita il giorno d."""
    return PRIMA_RIGA_PRESENZE + (d - date(anno, 1, 1)).days
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `.venv/bin/pytest test_comune.py -v`

Expected: PASS, 8 test.

- [ ] **Step 5: Far usare `comune.py` a `genera_presenze.py`**

In `genera_presenze.py` cancellare le righe 11-91 (gli import, le costanti, la palette, `intesta`, `titolo`) tranne `foglio_codici`, e mettere in cima al file, dopo il docstring:

```python
import calendar
import sys
from datetime import date, timedelta

from openpyxl import Workbook
from openpyxl.chart import BarChart, PieChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

from calendario import foglio_calendario
from comune import (AZZURRO, BLU_SCURO, BOX, CODICI, GIORNI, GRIGIO_INT, MESI,
                    N_COLLEGHE, TIPI_SCAMBIO, TURNI_LAVORATI, VERDE, intesta,
                    titolo)
from stipendio import foglio_stipendio
```

Gli import di `calendario` e `stipendio` puntano a moduli che non esistono ancora: vanno aggiunti solo in Task 8. Per ora inserire **solo** la riga `from comune import (...)`.

`foglio_codici` resta in `genera_presenze.py` immediatamente dopo gli import.

- [ ] **Step 6: Verificare che tutto passi ancora**

Run: `.venv/bin/pytest -v`

Expected: PASS, 11 test. Se compare `NameError`, manca un nome nella lista di import da `comune`.

- [ ] **Step 7: Commit**

```bash
git add comune.py test_comune.py genera_presenze.py
git commit -m "refactor: estrai costanti e stili in comune.py, aggiungi festivi italiani"
```

---

### Task 3: Griglia del calendario

Crea il foglio con i dodici blocchi mensili e i numeri dei giorni al posto giusto. Niente formule e niente colori: solo la geometria.

**Files:**
- Create: `calendario.py`
- Modify: `genera_presenze.py` (`main`, chiamata al nuovo foglio), `test_calendario.py`

**Interfaces:**
- Consumes: `riga_presenze`, `festivi_italiani`, `intesta`, `titolo`, `MESI`, `BOX`, `BLU_SCURO` da `comune`
- Produces: `foglio_calendario(wb, anno, cod_r1, cod_r2) -> ws`, foglio di nome `"Calendario"`. Costanti di modulo `PRIMA_RIGA_BLOCCHI = 10`, `COL_ORE = 8`, `GIORNI_BREVI`.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in fondo a `test_calendario.py`:

```python
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
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `.venv/bin/pytest test_calendario.py -v`

Expected: FAIL con `assert 'Calendario' in [...]` — il foglio non esiste.

- [ ] **Step 3: Creare `calendario.py`**

```python
"""Foglio Calendario: dodici mini-calendari mensili, in sola lettura.

Ogni cella e' una formula che punta alla riga del foglio Presenze di quel
giorno. Qui non si scrive niente: i turni si inseriscono in Presenze.
"""

import calendar
from datetime import date

from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from comune import BLU_SCURO, BOX, MESI, festivi_italiani, riga_presenze

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
```

- [ ] **Step 4: Agganciare il foglio a `main()`**

In `genera_presenze.py`, aggiungere l'import in cima:

```python
from calendario import foglio_calendario
```

e in `main()`, subito dopo la creazione del foglio Presenze:

```python
    _, cod_r1, cod_r2 = foglio_codici(wb)
    _, p_r1, p_r2 = foglio_presenze(wb, anno, cod_r1, cod_r2)
    foglio_calendario(wb, anno, cod_r1, cod_r2)
    foglio_riepilogo(wb, anno, p_r1, p_r2)
    foglio_scambi(wb, anno, p_r1, p_r2)
```

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `.venv/bin/pytest -v`

Expected: PASS, 16 test.

- [ ] **Step 6: Commit**

```bash
git add calendario.py genera_presenze.py test_calendario.py
git commit -m "feat: griglia mensile del foglio Calendario"
```

---

### Task 4: Formule del calendario

Riempie la griglia: codice turno, orario, ore della settimana, totale del mese.

**Files:**
- Modify: `calendario.py`, `test_calendario.py`

**Interfaces:**
- Consumes: `foglio_calendario(wb, anno, cod_r1, cod_r2)` da Task 3, `riga_presenze` da Task 2
- Produces: `_blocco_mese(ws, riga, anno, mese, lookup)` — firma estesa con `lookup`, la stringa di intervallo del foglio Codici (`"Codici!$A$5:$F$9"`)

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere a `test_calendario.py`:

```python
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
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `.venv/bin/pytest test_calendario.py -v`

Expected: FAIL, `assert None == '=IF(Presenze!$D$78=...'`.

- [ ] **Step 3: Aggiungere le formule a `_blocco_mese`**

Sostituire `_blocco_mese` in `calendario.py` con:

```python
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
```

- [ ] **Step 4: Passare `lookup` da `foglio_calendario`**

In `foglio_calendario`, sostituire il ciclo finale con:

```python
    lookup = f"Codici!$A${cod_r1}:$F${cod_r2}"
    r = PRIMA_RIGA_BLOCCHI
    for mese in range(1, 13):
        r = _blocco_mese(ws, r, anno, mese, lookup)
    return ws
```

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `.venv/bin/pytest -v`

Expected: PASS, 19 test.

- [ ] **Step 6: Commit**

```bash
git add calendario.py test_calendario.py
git commit -m "feat: formule di codice, orario, ore settimanali e totale mese"
```

---

### Task 5: Colori e legenda

Colora le righe numero in base al tipo di giorno, applica la formattazione condizionale ai turni e mette la legenda in cima al foglio.

**Files:**
- Modify: `calendario.py`, `test_calendario.py`

**Interfaces:**
- Consumes: `_blocco_mese` da Task 4, `festivi_italiani`, `orario_di`, `CODICI` da Task 2
- Produces: `_blocco_mese(ws, riga, anno, mese, lookup, festivi, aree)` — `aree` è un dict `{"cod": [str], "ora": [str]}` che accumula gli intervalli su cui applicare le regole di colore. Costanti `FERIALE`, `SABATO`, `DOMENICA`, `FESTIVO`, `VUOTO`, `COLORE_TURNO`.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere a `test_calendario.py`:

```python
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
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `.venv/bin/pytest test_calendario.py -v`

Expected: FAIL, `assert None == 'FAE6B8'`.

- [ ] **Step 3: Aggiungere le costanti di colore e l'helper**

In cima a `calendario.py`, dopo `GIORNI_BREVI`:

```python
# Colore della riga con il numero del giorno.
FERIALE = "FFFFFF"
SABATO = "DCE9F5"
DOMENICA = "F3DCE4"
FESTIVO = "FAE6B8"
VUOTO = "F7F9FB"     # giorni del mese precedente o successivo

# Colore delle righe codice e orario, applicato con formattazione condizionale
# perche' il codice si scrive dopo che il file e' stato generato.
COLORE_TURNO = {
    "L":  "EDF1F5",
    "M":  "FFF4CC",
    "M1": "FFE8A3",
    "P":  "FFE0C2",
    "P1": "FFCFA0",
}
```

e la funzione:

```python
def _colore_giorno(d, festivi):
    """Festivo batte domenica, domenica batte sabato."""
    if d in festivi:
        return FESTIVO
    if d.weekday() == 6:
        return DOMENICA
    if d.weekday() == 5:
        return SABATO
    return FERIALE
```

Aggiornare gli import di `calendario.py`:

```python
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from comune import (BLU_SCURO, BOX, CODICI, MESI, festivi_italiani, orario_di,
                    riga_presenze)
```

- [ ] **Step 4: Colorare le celle dentro `_blocco_mese`**

Cambiare la firma in `def _blocco_mese(ws, riga, anno, mese, lookup, festivi, aree):`.

Dentro il ciclo sui giorni della settimana, sostituire il `continue` con il riempimento grigio:

```python
        for i, d in enumerate(settimana, start=1):
            if d.month != mese:
                for rr in (r, r + 1, r + 2):
                    ws.cell(row=rr, column=i).fill = PatternFill("solid", fgColor=VUOTO)
                continue
            rp = riga_presenze(d, anno)
            n = ws.cell(row=r, column=i, value=d.day)
            n.font = Font(bold=True, size=11,
                          color="B03030" if d in festivi else "000000")
            n.fill = PatternFill("solid", fgColor=_colore_giorno(d, festivi))
```

(il resto del corpo del `for` — celle codice e orario — resta identico a Task 4).

Subito dopo il ciclo sui giorni, prima del calcolo delle ore, registrare gli intervalli:

```python
        aree["cod"].append(f"A{r + 1}:G{r + 1}")
        aree["ora"].append(f"A{r + 2}:G{r + 2}")
```

- [ ] **Step 5: Scrivere legenda e regole in `foglio_calendario`**

Sostituire `foglio_calendario` con:

```python
def _legenda(ws, anno):
    """Righe 1-8: cosa vogliono dire i colori."""
    ws["A1"] = f"Calendario {anno}"
    ws["A1"].font = Font(bold=True, size=16, color=BLU_SCURO)
    ws["A2"] = "Sola lettura: i turni si scrivono nel foglio Presenze."
    ws["A2"].font = Font(italic=True, size=10, color="5A6B7D")

    ws["A4"] = "Turni"
    ws["A4"].font = Font(bold=True, color=BLU_SCURO)
    for i, (cod, desc, _ini, _fin, _ore) in enumerate(CODICI, start=2):
        c = ws.cell(row=4, column=i, value=cod)
        c.font = Font(bold=True, size=12)
        c.fill = PatternFill("solid", fgColor=COLORE_TURNO[cod])
        c.alignment = Alignment(horizontal="center")
        c.border = BOX
        d = ws.cell(row=5, column=i, value=desc)
        d.font = Font(size=9, color="5A6B7D")
        d.alignment = Alignment(horizontal="center")

    ws["A7"] = "Giorni"
    ws["A7"].font = Font(bold=True, color=BLU_SCURO)
    for i, (testo, sfondo) in enumerate(
            [("Feriale", FERIALE), ("Sabato", SABATO),
             ("Domenica", DOMENICA), ("Festivo", FESTIVO)], start=2):
        c = ws.cell(row=7, column=i, value=testo)
        c.fill = PatternFill("solid", fgColor=sfondo)
        c.alignment = Alignment(horizontal="center")
        c.border = BOX

    ws["A8"] = "* accanto al codice = turno scambiato con una collega"
    ws["A8"].font = Font(italic=True, size=10, color="5A6B7D")


def foglio_calendario(wb, anno, cod_r1, cod_r2):
    """Crea il foglio Calendario. cod_r1/cod_r2 sono le righe dati del foglio Codici."""
    ws = wb.create_sheet("Calendario")
    for col in range(1, COL_ORE):
        ws.column_dimensions[get_column_letter(col)].width = 13
    ws.column_dimensions[get_column_letter(COL_ORE)].width = 9

    _legenda(ws, anno)

    festivi = festivi_italiani(anno)
    lookup = f"Codici!$A${cod_r1}:$F${cod_r2}"
    aree = {"cod": [], "ora": []}
    r = PRIMA_RIGA_BLOCCHI
    for mese in range(1, 13):
        r = _blocco_mese(ws, r, anno, mese, lookup, festivi, aree)

    # Una regola per valore su tutti gli intervalli insieme: Numbers importa
    # queste, non quelle basate su formula. "M" e "M*" sono due valori diversi,
    # quindi servono due regole per codice.
    zona_cod = " ".join(aree["cod"])
    zona_ora = " ".join(aree["ora"])
    for voce in CODICI:
        cod = voce[0]
        sfondo = PatternFill("solid", fgColor=COLORE_TURNO[cod])
        for atteso in (cod, f"{cod}*"):
            ws.conditional_formatting.add(zona_cod, CellIsRule(
                operator="equal", formula=[f'"{atteso}"'], fill=sfondo))
        ws.conditional_formatting.add(zona_ora, CellIsRule(
            operator="equal", formula=[f'"{orario_di(voce)}"'], fill=sfondo))
    return ws
```

- [ ] **Step 6: Eseguire i test e verificare che passino**

Run: `.venv/bin/pytest -v`

Expected: PASS, 24 test.

- [ ] **Step 7: Commit**

```bash
git add calendario.py test_calendario.py
git commit -m "feat: colori dei giorni, formattazione condizionale dei turni, legenda"
```

---

### Task 6: Ripartizione delle ore per lo stipendio

La parte delicata del foglio `Stipendio`: dividere le ore di ogni mese in ordinarie, sabato, domenica e festivi senza contarne nessuna due volte.

**Files:**
- Create: `stipendio.py`, `test_stipendio.py`
- Modify: `genera_presenze.py` (`main`)

**Interfaces:**
- Consumes: `festivi_italiani`, `riga_presenze`, `MESI`, `intesta`, `titolo`, `BOX`, `BLU_SCURO`, `GRIGIO_INT` da `comune`
- Produces: `foglio_stipendio(wb, anno, p_r1, p_r2) -> ws`, foglio `"Stipendio"`. Costanti `RIGA_PARAMETRI = 5`, `RIGA_TABELLA = 15` (intestazione), mesi su `16..27`, totale su `28`, controllo su `30`.

- [ ] **Step 1: Scrivere i test che falliscono**

`test_stipendio.py`:

```python
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
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `.venv/bin/pytest test_stipendio.py -v`

Expected: FAIL con `assert 'Stipendio' in [...]`.

- [ ] **Step 3: Creare `stipendio.py` con la sola ripartizione ore**

```python
"""Foglio Stipendio: simulazione del compenso mensile.

Le ore arrivano dal foglio Presenze. La tariffa e le maggiorazioni le scrive
l'utente nelle celle verdi: finche' sono vuote la tabella resta vuota.
"""

from datetime import date

from openpyxl.styles import Alignment, Font, PatternFill

from comune import BLU_SCURO, BOX, GRIGIO_INT, MESI, festivi_italiani, riga_presenze

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

    # Rete di sicurezza: le quattro categorie devono coprire tutte le ore, niente di piu'.
    ws.cell(row=RIGA_CONTROLLO, column=1,
            value="Controllo ripartizione ore (deve essere 0)").font = Font(
        bold=True, color="B03030")
    c = ws.cell(row=RIGA_CONTROLLO, column=2, value=(
        f"=B{RIGA_TOTALE}+C{RIGA_TOTALE}+D{RIGA_TOTALE}+E{RIGA_TOTALE}"
        f"-SUM({ore})"))
    c.font = Font(bold=True, color="B03030")
    c.border = BOX
    c.alignment = Alignment(horizontal="center")
    return ws
```

Aggiungere agli import di `stipendio.py`:

```python
from openpyxl.utils import get_column_letter

from comune import (BLU_SCURO, BOX, GRIGIO_INT, MESI, festivi_italiani,
                    intesta, riga_presenze, titolo)
```

- [ ] **Step 4: Agganciare il foglio a `main()`**

In `genera_presenze.py`, aggiungere l'import:

```python
from stipendio import foglio_stipendio
```

e in `main()`, dopo `foglio_scambi`:

```python
    foglio_stipendio(wb, anno, p_r1, p_r2)
```

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `.venv/bin/pytest -v`

Expected: PASS, 33 test.

- [ ] **Step 6: Commit**

```bash
git add stipendio.py test_stipendio.py genera_presenze.py
git commit -m "feat: ripartizione delle ore mensili per la simulazione stipendio"
```

---

### Task 7: Parametri, importi e grafico dello stipendio

Completa il foglio: le celle da compilare, le formule in euro, il grafico.

**Files:**
- Modify: `stipendio.py`, `test_stipendio.py`

**Interfaces:**
- Consumes: `foglio_stipendio` da Task 6
- Produces: parametri in `B5` (tariffa), `B6` (magg. sabato), `B7` (magg. domenica), `B8` (magg. festivo), `B9` (rateo 13a), `B10` (coefficiente netto)

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere a `test_stipendio.py`:

```python
def test_celle_dei_parametri_sono_vuote_e_verdi(wb):
    ws = wb["Stipendio"]
    etichette = [ws.cell(row=r, column=1).value for r in range(5, 11)]
    assert etichette == [
        "Tariffa oraria lorda", "Maggiorazione sabato", "Maggiorazione domenica",
        "Maggiorazione festivo", "Rateo 13a", "Coefficiente netto/lordo",
    ]
    for r in (5, 6, 7, 8, 10):
        c = ws.cell(row=r, column=2)
        assert c.value is None, r
        assert c.fill.fgColor.rgb[-6:] == "E8F3EA", r
    assert ws["B9"].value == "=1/12"


def test_gli_importi_restano_vuoti_finche_manca_la_tariffa(wb):
    ws = wb["Stipendio"]
    r = MESI_RIGHE["Gennaio"]
    assert ws.cell(row=r, column=6).value == (
        f'=IF($B$5="","",(B{r}+C{r}+D{r}+E{r})*$B$5)')
    assert ws.cell(row=r, column=7).value == f'=IF($B$5="","",C{r}*$B$5*$B$6)'
    assert ws.cell(row=r, column=8).value == f'=IF($B$5="","",D{r}*$B$5*$B$7)'
    assert ws.cell(row=r, column=9).value == f'=IF($B$5="","",E{r}*$B$5*$B$8)'
    assert ws.cell(row=r, column=10).value == (
        f'=IF($B$5="","",(F{r}+G{r}+H{r}+I{r})*$B$9)')
    assert ws.cell(row=r, column=11).value == (
        f'=IF($B$5="","",F{r}+G{r}+H{r}+I{r}+J{r})')


def test_il_netto_richiede_anche_il_coefficiente(wb):
    ws = wb["Stipendio"]
    r = MESI_RIGHE["Gennaio"]
    assert ws.cell(row=r, column=12).value == (
        f'=IF(OR($B$5="",$B$10=""),"",K{r}*$B$10)')


def test_formato_euro_sugli_importi(wb):
    ws = wb["Stipendio"]
    r = MESI_RIGHE["Gennaio"]
    for col in range(6, 13):
        assert ws.cell(row=r, column=col).number_format == '€ #,##0.00', col


def test_ce_il_grafico(wb):
    ws = wb["Stipendio"]
    assert len(ws._charts) == 1
    assert ws._charts[0].title is not None


def test_nota_sui_limiti(wb):
    ws = wb["Stipendio"]
    testi = [ws.cell(row=r, column=1).value for r in range(1, 15)]
    assert any(isinstance(t, str) and "straordinari" in t for t in testi)
    assert any(isinstance(t, str) and "busta paga" in t for t in testi)
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `.venv/bin/pytest test_stipendio.py -v`

Expected: FAIL, `assert [None, None, ...] == ['Tariffa oraria lorda', ...]`.

- [ ] **Step 3: Aggiungere il blocco parametri**

In `stipendio.py`, aggiungere la costante e la funzione:

```python
VERDE = "E8F3EA"

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
```

Chiamarla come prima istruzione dentro `foglio_stipendio`, subito dopo `ws = wb.create_sheet("Stipendio")`.

Nella lista degli import da `comune` in `stipendio.py`, `titolo` e `intesta` sono già presenti.

- [ ] **Step 4: Aggiungere le formule degli importi**

Dentro il ciclo sui mesi di `foglio_stipendio`, dopo la cella delle ore ordinarie e prima del ciclo che applica i bordi:

```python
        # Tutte le ore al lordo base, poi le maggiorazioni solo su sab/dom/fest.
        ws.cell(row=r, column=6, value=f'=IF($B$5="","",(B{r}+C{r}+D{r}+E{r})*$B$5)')
        ws.cell(row=r, column=7, value=f'=IF($B$5="","",C{r}*$B$5*$B$6)')
        ws.cell(row=r, column=8, value=f'=IF($B$5="","",D{r}*$B$5*$B$7)')
        ws.cell(row=r, column=9, value=f'=IF($B$5="","",E{r}*$B$5*$B$8)')
        ws.cell(row=r, column=10, value=f'=IF($B$5="","",(F{r}+G{r}+H{r}+I{r})*$B$9)')
        ws.cell(row=r, column=11, value=f'=IF($B$5="","",F{r}+G{r}+H{r}+I{r}+J{r})')
        ws.cell(row=r, column=12, value=f'=IF(OR($B$5="",$B$10=""),"",K{r}*$B$10)')
        for col in range(6, 13):
            ws.cell(row=r, column=col).number_format = '€ #,##0.00'
```

Applicare lo stesso formato alla riga del totale, dentro il ciclo che la stilizza:

```python
        if col >= 6:
            c.number_format = '€ #,##0.00'
```

- [ ] **Step 5: Aggiungere il grafico**

In fondo a `foglio_stipendio`, prima di `return ws`:

```python
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
```

Aggiungere l'import in cima a `stipendio.py`:

```python
from openpyxl.chart import BarChart, Reference
```

- [ ] **Step 6: Eseguire i test e verificare che passino**

Run: `.venv/bin/pytest -v`

Expected: PASS, 39 test.

- [ ] **Step 7: Commit**

```bash
git add stipendio.py test_stipendio.py
git commit -m "feat: parametri, importi in euro e grafico del foglio Stipendio"
```

---

### Task 8: Ordine dei fogli, rigenerazione, verifica in Numbers

Mette i fogli nell'ordine giusto, rigenera il file vero e verifica a mano quello che i test non possono verificare: come Numbers rende la formattazione condizionale.

**Files:**
- Modify: `genera_presenze.py:321-338` (`main`), `test_calendario.py`
- Regenerate: `Presenze_Vanessa_2026.xlsx`

**Interfaces:**
- Consumes: `foglio_calendario` (Task 5), `foglio_stipendio` (Task 7)
- Produces: workbook con i fogli in ordine `Presenze, Calendario, Codici, Riepilogo, Scambi, Stipendio`

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungere a `test_calendario.py`:

```python
def test_ordine_dei_fogli(wb):
    assert wb.sheetnames == [
        "Presenze", "Calendario", "Codici", "Riepilogo", "Scambi", "Stipendio",
    ]
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `.venv/bin/pytest test_calendario.py::test_ordine_dei_fogli -v`

Expected: FAIL, l'ordine effettivo mette `Codici` prima di `Calendario`.

- [ ] **Step 3: Riordinare i fogli in `main()`**

Sostituire `main()` in `genera_presenze.py`:

```python
ORDINE_FOGLI = ["Presenze", "Calendario", "Codici", "Riepilogo", "Scambi", "Stipendio"]


def main():
    anno = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    out = sys.argv[2] if len(sys.argv) > 2 else f"Presenze_Vanessa_{anno}.xlsx"

    wb = Workbook()
    wb.remove(wb.active)
    _, cod_r1, cod_r2 = foglio_codici(wb)
    _, p_r1, p_r2 = foglio_presenze(wb, anno, cod_r1, cod_r2)
    foglio_calendario(wb, anno, cod_r1, cod_r2)
    foglio_riepilogo(wb, anno, p_r1, p_r2)
    foglio_scambi(wb, anno, p_r1, p_r2)
    foglio_stipendio(wb, anno, p_r1, p_r2)
    for posizione, nome in enumerate(ORDINE_FOGLI):
        wb.move_sheet(nome, offset=posizione - wb.sheetnames.index(nome))
    wb.save(out)
    giorni = 366 if calendar.isleap(anno) else 365
    print(f"Creato {out} - {giorni} giorni, fogli: {', '.join(wb.sheetnames)}")
```

- [ ] **Step 4: Eseguire tutti i test**

Run: `.venv/bin/pytest -v`

Expected: PASS, 40 test.

- [ ] **Step 5: Rigenerare il file vero**

```bash
.venv/bin/python genera_presenze.py 2026 Presenze_Vanessa_2026.xlsx
```

Expected: `Creato Presenze_Vanessa_2026.xlsx - 365 giorni, fogli: Presenze, Calendario, Codici, Riepilogo, Scambi, Stipendio`

- [ ] **Step 6: Verifica manuale in Numbers**

Aprire `Presenze_Vanessa_2026.xlsx` in Numbers e controllare, scrivendo qualche codice di prova nel foglio `Presenze` (per esempio `M` sul 5 gennaio, `P1` sul 10 gennaio, `M1` sul 25 aprile):

1. Nel foglio `Calendario`, i codici compaiono nelle caselle giuste e l'orario sotto è corretto.
2. Le celle del codice **si colorano**. Questo è il punto incerto: la formattazione condizionale importata è la parte che Numbers gestisce peggio.
3. La colonna `Ore` della settimana e i totali del mese si aggiornano.
4. Scrivendo un `Cod. orig.` su un giorno, accanto al codice compare l'asterisco e il colore resta.
5. I colori di sabato, domenica e festivi sono quelli attesi (25 aprile giallo, non azzurro).
6. Nel foglio `Stipendio`, con la tariffa vuota le colonne in euro sono vuote; scrivendo una tariffa di prova (es. `10`) e le maggiorazioni gli importi compaiono.
7. Il controllo in `B30` vale 0.

**Se il punto 2 fallisce** — Numbers scarta le regole di colore — applicare il piano B: in `calendario.py`, invece delle `CellIsRule`, colorare staticamente il *font* delle celle codice e orario non è possibile (il codice non esiste ancora alla generazione), quindi il ripiego è rimuovere le regole e lasciare le due righe con lo sfondo del tipo di giorno, riportando l'esito qui prima di procedere. Non inventare una terza soluzione senza averla concordata.

- [ ] **Step 7: Commit e push**

```bash
git add genera_presenze.py test_calendario.py
git commit -m "feat: ordine dei fogli e rigenerazione del workbook"
git push
```

---

## Self-Review

**Copertura della spec:**

| Requisito della spec | Task |
|---|---|
| P 13:00–20:00 7h, P1 13:00–21:00 8h | 1 |
| Colonna `Codici!F` Orario | 1 |
| `festivi_italiani`, Pasqua, collisione Pasquetta/25 aprile | 2 |
| Divisione in `comune.py` / `calendario.py` / `stipendio.py` | 2, 3, 6 |
| Dodici blocchi mensili Lun–Dom, tre righe per settimana | 3 |
| Riferimenti diretti a `Presenze`, formula codice con `*` | 4 |
| Formula orario via VLOOKUP colonna 6 | 4 |
| Colonna Ore settimanale sui soli giorni del mese | 4 |
| Totale mese: ore e giorni lavorati | 4 |
| Colori feriale/sabato/domenica/festivo, caselle vuote | 5 |
| Formattazione condizionale a valore per i cinque codici | 5 |
| Legenda | 5 |
| Ripartizione ore con precedenza festivo > domenica > sabato | 6 |
| Riga di controllo | 6 |
| Parametri vuoti, rateo 1/12 | 7 |
| Formule lordo, maggiorazioni, rateo, netto | 7 |
| Grafico | 7 |
| Limiti dichiarati nel foglio | 7 |
| Output sovrascritto, `.numbers` intoccati | 8 |
| Verifica in Numbers e piano B | 8 |
| `requirements.txt`, `README.md`, `.gitignore` | 1, già fatto |

**Nota sulla numerazione dei parametri:** la spec collocava i parametri in `B4:B9`; il piano li mette in `B5:B10` perché la riga 4 ospita l'intestazione `Parametro | Valore`. Le formule del piano usano coerentemente `$B$5` per la tariffa e `$B$10` per il coefficiente netto.

**Nota sull'asterisco:** la spec chiede il `*` accanto al codice. Con una regola «testo uguale a M» la cella `M*` non verrebbe colorata, quindi ogni codice ha due regole, `"M"` e `"M*"`. L'asterisco resta dove previsto.

---

## Correzioni emerse in esecuzione

Due difetti di questo piano scoperti dalle review, corretti in corsa. Chi rilegge il piano deve sapere che le versioni qui sopra sono superate.

**Task 5 — il test delle regole di colore non aveva denti.** `test_regole_di_colore_per_ogni_codice` raccoglie le formule delle regole in un `set()` e verifica solo l'appartenenza: se gli intervalli saltassero un blocco mensile o fossero sfasati di una riga, il test passerebbe e mezzo anno resterebbe senza colore. Aggiunto `test_le_regole_di_colore_coprono_tutte_le_righe_con_formula`, che confronta l'insieme delle righe con formula codice/orario con l'insieme delle righe coperte dagli `sqref`. Verificato per mutazione: fallisce sia togliendo un blocco sia sfasandolo di una riga.

**Task 6 — la riga di controllo era una tautologia.** `B+C+D+E-SUM(ore)` non può mai essere diverso da zero, perché le ore ordinarie sono definite come resto: `B = SUMIFS(mese)-C-D-E`. Dimostrato iniettando due guasti veri (rimossa la sottrazione del 25 aprile dalle ore di sabato; azzerati i festivi di dicembre): il controllo è rimasto `0` in entrambi i casi. Sostituita con `=MIN(B16:B27)` etichettata «deve essere >= 0», che coglie la forma reale del guasto — un giorno contato due volte erode la colonna delle ordinarie. Aggiunta inoltre una property test che cammina tutti i giorni dell'anno e verifica che ogni riga di `Presenze` cada in esattamente una delle quattro categorie.

Il conteggio dei test nei Task 6, 7 e 8 va aumentato di conseguenza: i valori scritti sopra (33, 39, 40) sono precedenti a queste aggiunte.
