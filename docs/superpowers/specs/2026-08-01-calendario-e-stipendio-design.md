# Vista calendario mensile e simulazione stipendio

Data: 2026-08-01
Stato: approvato

## Obiettivo

Il foglio `Presenze` è una lista di 365 righe: si compila bene, si guarda male. Servono due
aggiunte al workbook generato da `genera_presenze.py`:

1. **`Calendario`** — dodici mini-calendari mensili in griglia Lun–Dom, in sola lettura, per
   vedere a colpo d'occhio come è disposta la settimana.
2. **`Stipendio`** — simulazione del compenso mensile a partire da una tariffa oraria, con
   maggiorazioni per sabato, domenica e festivi, rateo di tredicesima e stima del netto.

Il file di output resta `Presenze_Vanessa_2026.xlsx`, sovrascritto. I file `.numbers` non
vengono toccati da nessuna parte del programma.

## Vincolo trasversale: Numbers

Il workbook si apre in Numbers, non in Excel. Questo detta tre scelte:

- riferimenti diretti alle celle (`Presenze!$D$47`) invece di ricerche per data;
- formattazione condizionale **a valore** (`il testo è uguale a "M"`) invece che a formula,
  perché è la sola che Numbers importa in modo affidabile;
- niente tabelle strutturate, niente nomi definiti, niente formule di array.

## 1. Codici turno aggiornati

La tabella `CODICI` cambia negli orari del pomeriggio, e le ore seguono l'orario:

| Cod | Descrizione | Inizio | Fine | Ore |
|-----|-------------|--------|------|-----|
| L | Libero | | | 0 |
| M | Mattina | 07:00 | 13:00 | 6 |
| M1 | Mattina lunga | 07:00 | 14:00 | 7 |
| P | Pomeriggio | 13:00 | **20:00** | **7** |
| P1 | Pomeriggio lungo | 13:00 | **21:00** | **8** |

Valori precedenti: P 13:00–19:00 / 6 ore, P1 13:00–20:00 / 7 ore. Riepilogo, Scambi e i totali
di Presenze leggono le ore dal foglio `Codici`, quindi si ricalcolano da soli.

### Colonna `Orario` nel foglio `Codici`

Si aggiunge la colonna **F "Orario"** con formula `=IF(C5="","–",C5&"-"&D5)`, che produce
`07:00-13:00`. Serve al calendario, che così fa un solo VLOOKUP.

È additiva: le formule esistenti usano `Codici!$A$5:$E$9` e l'indice 5, e restano valide.
L'intestazione di riga 4 passa da 5 a 6 colonne; larghezze `[10, 22, 12, 12, 10, 16]`.

## 2. Foglio `Calendario`

Inserito subito dopo `Presenze`. Interamente in sola lettura: ogni cella è una formula che
punta alla riga di `Presenze` corrispondente a quel giorno.

```
riga_presenze(d) = 5 + (d - date(anno, 1, 1)).days
```

### Colonne

| Col | Contenuto | Larghezza |
|-----|-----------|-----------|
| A–G | Lunedì … Domenica | 13 |
| H | Ore della settimana | 9 |

### Legenda

In cima al foglio, prima dei blocchi mensili: un campione di colore per ciascuno dei cinque
codici turno, uno per sabato, domenica e festivo, e la riga «`*` accanto al codice = giorno di
scambio con una collega».

### Blocco mensile

Dodici blocchi, uno sotto l'altro, separati da una riga vuota. Ogni blocco:

1. **Titolo** — `GENNAIO 2026`, unito da A a H.
2. **Intestazione** — `Lun … Dom` + `Ore`, in stile scuro.
3. **Settimane** — da 4 a 6 gruppi da **tre righe** ciascuno:
   - *riga numero*: il numero del giorno, valore statico, altezza 18
   - *riga codice*: il codice turno, grassetto, altezza 20
   - *riga orario*: l'orario del turno, testo piccolo grigio, altezza 14
4. **Totale mese** — `TOTALE GENNAIO`, ore totali e giorni lavorati.

Le caselle dei giorni appartenenti al mese precedente o successivo restano vuote, sfondo
`F7F9FB`.

### Formule delle celle giorno

Per un giorno la cui riga in `Presenze` è `47`:

| Riga | Formula |
|------|---------|
| numero | valore statico `16` |
| codice | `=IF(Presenze!$D$47="","",Presenze!$D$47&IF(Presenze!$F$47="","","*"))` |
| orario | `=IF(Presenze!$D$47="","",IFERROR(VLOOKUP(Presenze!$D$47,Codici!$A$5:$F$9,6,FALSE),""))` |

L'asterisco compare quando in `Presenze` la colonna `Cod. orig.` è valorizzata, cioè quando
quel turno è stato oggetto di uno scambio.

### Colonna Ore

Unita sulle tre righe della settimana. Somma le ore dei giorni **visibili** in quel blocco: le
righe di `Presenze` sono cronologiche, quindi i giorni di una settimana dentro un mese sono
sempre contigui.

```
=IF(SUM(Presenze!$E$47:$E$53)=0,"",SUM(Presenze!$E$47:$E$53))
```

Una settimana a cavallo di due mesi compare in entrambi i blocchi, ciascuna volta con il totale
dei soli giorni di quel mese. Questo tiene la colonna Ore coerente con il totale del mese.

### Totale mese

```
ore              =SUM(Presenze!$E$5:$E$35)
giorni lavorati  =COUNTIF(Presenze!$E$5:$E$35,">0")
```

### Colori

Due livelli, su righe diverse, così non si sovrappongono.

**Riga numero** — statica, decisa alla generazione:

| Tipo giorno | Sfondo | Testo |
|---|---|---|
| feriale | `FFFFFF` | nero |
| sabato | `DCE9F5` | nero |
| domenica | `F3DCE4` | nero |
| festivo | `FAE6B8` | `B03030` grassetto |

**Righe codice e orario** — formattazione condizionale, perché il codice viene scritto dopo la
generazione:

| Codice | Sfondo |
|---|---|
| M | `FFF4CC` |
| M1 | `FFE8A3` |
| P | `FFE0C2` |
| P1 | `FFCFA0` |
| L | `EDF1F5` |

Sulla riga codice le regole confrontano il testo con il codice (`M`, `M1`, …). Sulla riga
orario confrontano il testo con la stringa dell'orario (`07:00-13:00`, …), che è univoca per
codice: sono regole a valore, quelle che Numbers importa meglio.

Conseguenza da conoscere: se in `Codici` si modifica un orario, il colore della riga orario
smette di applicarsi finché il file non viene rigenerato. Codici, ore e importi continuano a
funzionare.

Rischio residuo: la formattazione condizionale importata è la parte meno garantita del lavoro.
Va verificata aprendo il file in Numbers. Se Numbers la scarta, il piano B è colorare
staticamente il *testo* del codice invece dello sfondo.

### Festivi italiani

Funzione `festivi_italiani(anno) -> dict[date, str]`:

1 gennaio, 6 gennaio, lunedì dell'Angelo, 25 aprile, 1 maggio, 2 giugno, 15 agosto,
1 novembre, 8 dicembre, 25 dicembre, 26 dicembre.

La Pasqua si calcola con l'algoritmo gregoriano anonimo (nessuna dipendenza nuova); la
Pasquetta è il giorno dopo. Il patrono locale non è incluso.

## 3. Foglio `Stipendio`

Ultimo foglio. Due parti: parametri da riempire a mano, e simulazione calcolata.

### Parametri

Celle di input verdi, colonna B. Partono **vuote**: finché non sono compilate la tabella mostra
celle vuote, non zeri che sembrano risultati.

| Cella | Parametro |
|---|---|
| B4 | Tariffa oraria lorda (€) |
| B5 | Maggiorazione sabato (%) |
| B6 | Maggiorazione domenica (%) |
| B7 | Maggiorazione festivo (%) |
| B8 | Rateo 13a — preimpostato `=1/12`, modificabile |
| B9 | Coefficiente netto/lordo (%) |

Nota in chiaro accanto ai parametri: la tariffa oraria va presa dal contratto o dalla busta
paga (CCNL Cooperative Sociali, OSS livello C1); il coefficiente netto/lordo si ottiene
dividendo il netto di una busta paga vera per il suo lordo.

### Tabella mensile

Dodici righe più il totale anno.

`Mese | Ore ord. | Ore sab | Ore dom | Ore fest | Lordo base | Magg. sab | Magg. dom | Magg. fest | Rateo 13a | Lordo totale | Netto stimato`

Le ore si ricavano senza modificare la struttura di `Presenze`:

- **Ore festivi** — somma diretta delle celle `Presenze!$E$n` dei festivi di quel mese, righe
  note al momento della generazione. Mese senza festivi: `0`.
- **Ore sabato** — `SUMIFS` su `Mese` e `Giorno="Sabato"`, meno le ore dei festivi che
  quell'anno cadono di sabato.
- **Ore domenica** — idem con `Giorno="Domenica"`, meno i festivi di domenica.
- **Ore ordinarie** — `SUMIFS` sulle ore per quel mese, meno le tre categorie sopra.

**Precedenza: festivo > domenica > sabato.** Ogni ora ricade in esattamente una categoria, mai
due maggiorazioni sullo stesso giorno.

Importi, tutti condizionati a `IF($B$4="","",…)`:

```
Lordo base   = (ore ord + sab + dom + fest) * tariffa
Magg. sab    = ore sab  * tariffa * %sab
Magg. dom    = ore dom  * tariffa * %dom
Magg. fest   = ore fest * tariffa * %fest
Rateo 13a    = (lordo base + maggiorazioni) * rateo
Lordo totale = lordo base + maggiorazioni + rateo
Netto stim.  = lordo totale * coeff. netto
```

### Riga di controllo

Sotto la tabella, sulla riga del totale anno: la somma delle quattro colonne ore deve coincidere
con `SUM(Presenze!$E$5:$E$369)`, cioè le ore totali dell'anno. La differenza deve essere zero;
se non lo è, la cella si accende in rosso. È la rete di
sicurezza contro un errore nella ripartizione sabato/domenica/festivo, sullo stesso principio
della riga «Da controllare (refusi)» del foglio `Scambi`.

### Grafico

Istogramma del lordo totale mensile con il netto stimato accanto.

### Limiti dichiarati nel foglio

Non calcola: straordinari, lavoro notturno (i turni finiscono alle 21), scatti di anzianità,
TFR, conguagli fiscali, addizionali regionali e comunali. È una stima di ciò che ci si può
aspettare, non una busta paga.

## 4. Struttura del codice

`genera_presenze.py` è a 339 righe; le due aggiunte ne porterebbero circa 300. Si divide in
quattro moduli nella stessa cartella, lasciando invariato il modo di lanciarlo:

```
python3 genera_presenze.py 2026 Presenze_Vanessa_2026.xlsx
```

| File | Contenuto |
|------|-----------|
| `comune.py` | palette, `intesta()`, `titolo()`, `BOX`, `CODICI`, `TIPI_SCAMBIO`, `MESI`, `GIORNI`, `festivi_italiani()`, `riga_presenze()` |
| `calendario.py` | `foglio_calendario()` |
| `stipendio.py` | `foglio_stipendio()` |
| `genera_presenze.py` | `main()` e i quattro fogli esistenti |

Nessun refactoring oltre a questo spostamento.

## 5. Test

Il progetto non ha test. Se ne aggiunge uno, `test_calendario.py` (pytest), scritto prima del
codice. Genera il workbook in una cartella temporanea, lo rilegge con openpyxl e verifica:

**Codici**
- P vale 7 ore, P1 vale 8 ore
- `Codici!F4` è l'intestazione `Orario` e `Codici!F5` contiene la formula di concatenazione

**Calendario**
- il 1 gennaio 2026 (giovedì) sta nella quarta colonna della prima settimana, e le tre caselle
  precedenti sono vuote
- la cella codice del 15 marzo punta esattamente alla riga di `Presenze` del 15 marzo
- il 25 aprile e il lunedì dell'Angelo hanno lo sfondo festivo
- domeniche e sabati hanno i rispettivi sfondi
- la colonna Ore di una settimana a cavallo di due mesi somma, in ciascun blocco, solo i giorni
  di quel mese, e le due somme insieme coprono l'intera settimana
- il totale di ogni mese copre tutti i giorni del mese, senza sovrapposizioni tra mesi
- esistono le regole di formattazione condizionale per tutti e cinque i codici

**Stipendio**
- per ogni mese, ore ordinarie + sabato + domenica + festivi = ore totali del mese
- nessun festivo che cade di domenica viene conteggiato anche tra le ore di domenica
- le celle dei parametri sono vuote e le colonne importi sono condizionate a `$B$4`

## 6. Setup

`openpyxl` non è installato nell'ambiente corrente. Si aggiungono:

- `.venv/` creato con `python3 -m venv .venv`
- `requirements.txt` — `openpyxl`, `pytest`
- `README.md` — due comandi: come installare e come generare
- `.gitignore` — `.venv/`, `*.xlsx`, `*.numbers`, `__pycache__/`

## Fuori scopo

- Scrivere i codici turno dal calendario: l'inserimento resta nel foglio `Presenze`, unica
  fonte di verità
- Calcolo fiscale reale del netto
- Modifica della struttura a colonne del foglio `Presenze`
- Generazione o modifica di file `.numbers`
