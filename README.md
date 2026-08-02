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
