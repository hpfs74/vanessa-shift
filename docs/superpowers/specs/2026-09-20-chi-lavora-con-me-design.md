# Chi lavora con me

Data: 2026-09-20
Stato: approvato

## Obiettivo

Quando si legge la foto del foglio, tenere anche i turni degli altri, e mostrare nel calendario
chi c'è lo stesso giorno — soprattutto chi si sovrappone davvero alle sue ore.

Oggi l'import legge **una riga sola**, la sua, e il prompt in `api/src/vision.ts` lo dice
esplicitamente: *«Devi leggere UNA SOLA riga»*. Il resto del foglio viene guardato e buttato. Ma
il foglio appeso in reparto è una griglia di quindici persone, e la domanda che si fa aprendo il
calendario non è solo «che turno ho giovedì»: è «giovedì chi c'è con me». Quella risposta è già
dentro la foto che ha appena caricato. Si sta scartando.

## Cosa questo NON fa

**Non cambia niente di quello che si calcola.** Ore, stipendio, esportazione `.ics`, saldi degli
Scambi: tutto resta funzione della sua sola riga. I turni degli altri sono contesto in sola
lettura. Nessuna funzione di `pay.ts`, `ics.ts` o `summary.ts` li vede.

**Non si corregge cella per cella.** La sua riga tiene l'editor che ha adesso. Gli altri si
guardano e basta. Quindici righe per trentuno giorni fanno quasi cinquecento celle: un editor che
le copre tutte è un editor che non userebbe mai, e costruirlo significherebbe fingere che quel
dato valga quanto il suo.

**Non è una rubrica.** Non c'è un elenco di colleghe da tenere aggiornato da qualche parte. Le
persone esistono solo dentro il mese in cui sono state lette, esattamente come le sigle.

**Non alimenta gli Scambi.** Il normalizzatore del nome è lo stesso — `normaliseColleague` di
`swaps.ts` — ma il concetto no. Lì una collega è una persona con cui ha un debito di favori, e il
nome lo digita lei. Qui è una riga letta da una foto, che può essere sbagliata e che nessuno ha
confermato. Farle confluire vorrebbe dire che una lettura storta sposta un saldo.

**Non esce nel `.ics`.** Vedi *Cosa si sta conservando*.

## Decisione: tutto il foglio, non un elenco scelto

Si leggono **tutte le righe**, non solo quelle di qualche collega selezionata in anticipo.

L'alternativa — lei sceglie una volta le persone che le interessano — sembra più economica e più
discreta, ma sposta su di lei una manutenzione che il foglio non ha: in reparto le persone
entrano ed escono, e un elenco scelto a marzo è sbagliato a settembre senza che niente lo segnali.
Peggio, il costo che risparmierebbe non è il costo vero: il modello deve comunque **guardare**
tutta la griglia per allineare le colonne, che le righe le riporti o no.

## Decisione: le sigle degli altri si copiano, non si interpretano

Le altre righe portano sigle che l'app non ha mai modellato. Il prompt attuale le elenca proprio
per dire di ignorarle: *«F, R, C, N1 e altre»*.

`ShiftCode` in `core/src/shifts.ts` è un'unione chiusa di cinque valori, ed è chiusa per una
ragione: da quella sigla discendono le ore, e dalle ore lo stipendio. Aprirla per far entrare `F`
significherebbe dover dire quante ore vale `F`, e nessuno lo sa.

Quindi la sigla di un altro si conserva **come stringa, così com'è scritta**. Dove coincide con
una delle cinque note, l'app sa gli orari e può dire «Giulia è di mattina con te». Dove non
coincide, si mostra la lettera e si tace sul resto.

Il guadagno vero non è la semplicità: è che **una sigla nuova non rompe l'import**. Se il reparto
inventa `N2` a novembre, la foto di novembre si legge lo stesso.

Due normalizzazioni, piccole e necessarie:

- la sigla si porta a maiuscolo, si tolgono gli spazi, e si taglia a **4 caratteri**. Il tetto non
  è estetico: è quello che impedisce a un modello che sbanda di salvare una frase dentro una cella.
- il nome passa per `normaliseColleague` (trim, spazi multipli collassati).

Due righe che normalizzano allo stesso nome **restano due persone**. Sul foglio due Giulia sono
due righe diverse, e fonderle sarebbe inventare. Il numero di riga, quando il foglio lo mostra,
serve da didascalia per distinguerle.

## Decisione: un elemento per mese, non uno per persona-giorno

```
pk = ROSTER#2026    sk = 09

{ pk, sk, people: [ { name: "Giulia", row: 4, codes: "M,M,P,,P1,L,…" } ] }
```

I turni di una persona per un mese stanno in **una stringa sola**, separata da virgole, con il
segmento vuoto per la cella vuota. L'alternativa — una lista di 31 elementi per persona — farebbe
quasi cinquecento valori dentro un item per niente: il mese non si legge mai a pezzi.

Un mese realistico pesa 1–2 KB, contro il tetto di 400 KB di DynamoDB.

Questa forma è stata scelta **perché la sostituzione integrale diventa una `PutCommand`**. La
regola decisa è che la foto nuova è la verità del mese: chi è sparito dal foglio sparisce dal
calendario. Con una riga per persona-giorno quella regola vuole una query, una cancellazione e
una riscrittura — e il momento fra la cancellazione e la riscrittura è il momento in cui un errore
lascia un mese mezzo vuoto. Con un item solo quel momento non esiste.

Si noti l'asimmetria voluta con i suoi turni, che invece **non si cancellano mai**: una foto
tagliata non deve poter perdere un giorno vero. Le due regole sono opposte perché i due dati lo
sono — il suo è l'originale, il resto è una copia di un foglio che viene riemesso.

## Decisione: una chiamata sola, due forme

Il modello viene invocato **una volta**, e risponde con la sua riga nella forma ricca di oggi più
un array `others` compatto.

Una seconda chiamata dedicata agli altri terrebbe `vision.ts` intatto, ma raddoppierebbe la spesa
per foto e consumerebbe **due** delle dieci letture giornaliere di `MAX_READINGS_PER_DAY`. La
stessa immagine verrebbe caricata e ragionata due volte per leggere una griglia che è una sola.

### Il contratto

```ts
others: {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      name:  { type: 'string' },
      row:   { anyOf: [{ type: 'integer' }, { type: 'null' }] },
      codes: { type: 'array', items: { type: 'string' } },   // '' = cella vuota
    },
    required: ['name', 'row', 'codes'],
    additionalProperties: false,
  },
}
```

Niente `confident` sulle celle altrui. Il flag serve a sottolineare una cella che lei può
correggere; qui non si corregge niente, quindi sarebbe solo peso.

Del prompt **non si tocca l'allineamento**. La riga dei numeri dei giorni in testa alle colonne è
quello che ha risolto il fuori-registro di luglio — una riga letta una colonna in anticipo, ogni
turno spostato di un giorno, e riportata come certa. Con quindici righe quell'istruzione conta di
più, non di meno.

Quello che si inverte è l'istruzione sulle righe: da *leggi solo la sua* a *leggi la sua in
dettaglio, e tutte le altre in forma compatta*. L'avvertimento sulle sigle estranee resta, ma
cambia di segno: non più «non riportarle mai», bensì «copiale così come sono».

### I token

`MAX_TOKENS` passa da **8000 a 16000**.

Il conto che lo impone: la forma della sua riga spende circa 25 token al giorno
(`{day, code, confident}`). Applicata a quindici persone per trentun giorni farebbe circa 12.000
token di solo JSON, prima di qualunque ragionamento — e la risposta verrebbe troncata. La forma
compatta costa circa 31 token a persona più il nome: **intorno a 700 token per tutta la squadra**.

Resta che la risposta è più lunga, quindi il troncamento è più probabile. Non è un caso nuovo:
`VisionFailed('truncated')` esiste già e diventa un 422 con la via d'uscita di sempre — scrivere i
codici a mano. Questa modifica rende quel sentiero un po' più battuto.

`MAX_READINGS_PER_DAY` **resta 10**. Ogni lettura costa di più; non ne servono di più.

## Decisione: validazione asimmetrica

`validateReading` non cambia di una riga, e continua a essere all-or-nothing: una griglia mezza
plausibile è peggio di un errore, perché si salva senza che nessuno se ne accorga.

`validateRoster` è **best-effort**. Una persona la cui `codes` non ha la lunghezza del mese viene
scartata; le altre sopravvivono. Solo un contenitore inutilizzabile fa eccezione.

L'all-or-nothing non sparisce: **scende di livello**, dalla lettura alla singola riga. Una riga
letta male è una riga persa, non un mese perso — e mai, in nessun caso, l'import suo.

Per questo nell'handler l'ordine è obbligatorio:

```ts
const reading = validateReading(raw, year());
return ok({ reading, roster: validateRoster(raw, reading.year, reading.month) });
```

`validateReading` parla per prima. Se la sua riga non va, la richiesta fallisce esattamente come
oggi. `validateRoster` non può buttare via una richiesta: al peggio restituisce `people` vuoto.

Il mese del roster **viene dal `reading`**, non da un campo suo: la foto è una, e il mese è quello
che il modello ha letto nel titolo. Due fonti per lo stesso mese vorrebbero dire poterle vedere in
disaccordo.

## Se lei corregge il mese

La schermata di import lascia correggere il mese letto dal titolo, e non per capriccio: se il
modello sbaglia il titolo, rifare la foto non aiuta — rileggerebbe lo stesso titolo. Cambiando il
mese, la sua griglia si accorcia o si allunga (`setMonth` in `PhotoImport.tsx`).

**Il roster deve seguire la stessa correzione**, con la stessa regola, applicata a ogni persona:
un mese più corto perde le sigle dei giorni che non esistono più, uno più lungo le aggiunge vuote.

Non è un dettaglio cosmetico. Il mese corretto è la `sk` sotto cui il roster viene scritto: se le
due cose divergono, i suoi turni finiscono in settembre e il roster in agosto, e il calendario
mostra le persone sbagliate senza che niente segnali l'errore. La riconciliazione sta in un posto
solo — la stessa funzione che rimodella la sua griglia rimodella anche il roster — e ha un test
suo.

## Codice nuovo

### `core/src/roster.ts`

Un file nuovo, non un'aggiunta a `photo.ts`. Quel file esiste per enunciare una regola — *«la
validazione è quindi tutto-o-niente»* — e infilarci dentro la regola opposta trasformerebbe quel
commento in una bugia.

```ts
export interface RosterPerson {
  readonly name: string;              // come sta scritto sul foglio, spazi normalizzati
  readonly row: number | null;        // didascalia: nessuno ci calcola niente
  readonly codes: readonly string[];  // lunghezza = giorni del mese; '' = nessun turno
}

export interface MonthRoster {
  readonly year: number;
  readonly month: number;
  readonly people: readonly RosterPerson[];
}
```

Quattro funzioni:

- `validateRoster(v, year, month): MonthRoster` — best-effort, come sopra. Scarta chi ha `codes`
  di lunghezza sbagliata, chi ha nome vuoto, e **chi normalizza al nome di Vanessa**: la sua riga
  sta già nel `reading`, e comparire due volte la farebbe risultare in turno con sé stessa.
- `overlaps(a, b): boolean` — vedi sotto.
- `rosterOnDay(roster, date)` — chi c'è quel giorno, diviso fra chi si sovrappone e chi no.
- `countOverlapping(roster, date, myCode): number` — il numero che finisce nella cella.

### La sovrapposizione

Due turni sono «insieme» solo quando **entrambe** le sigle si risolvono in `SHIFTS` con orari veri
e gli intervalli si intersecano:

```
overlaps(a, b)  ⇔  aStart < bEnd  ∧  bStart < aEnd
```

Gli estremi che si toccano non contano:

| | |
|---|---|
| `M` 07:00–13:00 e `P` 13:00–20:00 | **no** — si danno il cambio, non si incontrano |
| `M1` 07:00–14:00 e `P` 13:00–20:00 | **sì** — un'ora insieme |
| `L` (libero, nessun orario) | **mai** |
| `F`, `N1`, qualunque sigla ignota | **mai** |

L'ultima riga è la scelta importante. Una sigla che l'app non conosce non ha orari, e indovinare
sarebbe peggio del silenzio: dire «sei con Anna» quando Anna fa il notturno è un'informazione
falsa, mentre non dirlo è solo un'informazione mancante. La persona compare comunque, sotto
*Quel giorno*.

### `api/src/repo.ts`

```ts
readRoster(year: number, month: number): Promise<MonthRoster | null>;
saveRoster(r: MonthRoster): Promise<void>;   // una sola Put: la sostituzione è atomica
```

Nessun delete, nessuna query. La regola scelta *è* una `PutCommand`.

### Le rotte

Lato API (`/api/*`, non la Lambda della foto), più il cablaggio in `infra/lib/app-stack.ts`:

```
GET  /roster/{year}/{month}   →  { roster: MonthRoster | null }
PUT  /roster/{year}/{month}   →  sostituisce quel mese
```

Passano per l'helper `route()` che c'è già, quello che attacca `HttpJwtAuthorizer` a ogni rotta:
l'autenticazione non è qualcosa da ricordarsi di aggiungere, arriva perché si usa quella funzione.
Il commento poco sopra in `app-stack.ts` parla di *«all five routes»* e andrà corretto: diventano
sette.

Separate da `PUT /shifts` di proposito. I suoi turni non cancellano mai, il roster sostituisce in
blocco. Lo stesso handler vorrebbe dire una funzione che tiene in mano due promesse opposte.

## La schermata

### L'import

La sua griglia resta identica. Sotto, una riga richiudibile — *«lette 14 persone»* — che si apre
su una griglia compatta in sola lettura, i nomi di fianco, per l'occhiata: una riga intera
spostata o un nome irriconoscibile si vedono da lì, e sono esattamente gli errori che contano.

Un solo pulsante di salvataggio, due chiamate, **prima i suoi turni**. Se poi fallisce il roster,
il suo import è comunque riuscito e il messaggio lo dice, invece di lasciar credere che sia andato
perso tutto.

### Il calendario

`Calendar` prende una prop nuova e opzionale, `roster?: MonthRoster`. La cella mostra il conteggio
delle sovrapposizioni quando è maggiore di zero.

L'`aria-label` si allunga con `, 3 colleghi con te`: il numero nella cella non può essere
un'informazione per soli vedenti.

Il mese carica il suo roster **quando cambia mese**, una `Get`. Non segue la strada dei suoi
turni, che si caricano per l'anno intero: dodici mesi di griglia sarebbero un payload grosso per
un dato che si guarda un mese alla volta.

### Il foglio del giorno

Un blocco in sola lettura sotto l'editor che c'è già: *Con te*, poi *Quel giorno*. Niente lì
dentro è modificabile.

## Test

In TDD, e i casi interessanti stanno quasi tutti in `core`.

`core/test/roster.test.ts`

- una persona malformata viene scartata, le altre restano
- `codes` di lunghezza sbagliata per quel mese → persona scartata
- il nome di Vanessa non finisce mai in `people`, in nessuna combinazione di maiuscole
- due righe con lo stesso nome restano due persone
- una sigla lunga viene tagliata a 4 caratteri
- `overlaps`: falso per `M`/`P`, vero per `M1`/`P`, falso se **una qualsiasi** delle due è ignota
- `countOverlapping` su un giorno in cui lei è libera
- correggendo il mese, le `codes` di ogni persona si accorciano e si allungano come la sua griglia

`api/test/repo.test.ts`

- round-trip di un mese
- risalvare un mese con meno persone **perde davvero** quelle che mancano

`api/test/handlers.test.ts`

- un roster che non valida restituisce comunque 200 con il `reading`
- le due rotte nuove

`web/test/photoImport.test.tsx`

- il blocco del roster compare e si apre
- l'ordine di salvataggio
- il messaggio quando fallisce solo il roster

`web/test/app.test.tsx`

- il conteggio nella cella e l'`aria-label` esteso

## Cosa si sta conservando

Questo mette in un'app personale il turnario completo di un reparto ospedaliero, con nomi e
cognomi di persone che non l'hanno installata.

Sta dietro la passkey come tutto il resto, non lascia l'account, e **non entra nell'esportazione
`.ics`**: il file `.ics` si manda in giro per natura — si apre nel calendario del telefono, si
inoltra, finisce in un backup — e i turni di terzi non devono viaggiare dentro un file pensato per
essere condiviso.

Nell'app non esiste un gesto per cancellarlo. L'API sì: un `PUT /roster` con `people` vuoto
sostituisce il mese con niente, perché quella rotta rimpiazza tutto il mese in un colpo — è la
stessa rotta che lo scrive. Che il client non mandi mai un `people` vuoto (vedi il commento su
quella riga in `PhotoImport.tsx`) è una scelta, non una dimenticanza. E anche se quel gesto
esistesse, la cancellazione non sarebbe immediata: la tabella ha il point-in-time recovery attivo,
quindi un mese tolto per errore resta recuperabile per un po', non sparisce nell'istante in cui
viene tolto. È il compromesso giusto, perché lo stesso PITR è ciò che protegge i turni **suoi**
da uno sbaglio fatto da lei, da accesso effettuato — non serve un TTL a parte, e non ne va aggiunto
uno solo per questo: tornare indietro a marzo e vedere chi c'era è la funzione, non un effetto
collaterale da spegnere.

Vale la pena scriverlo invece di lasciarlo implicito, perché è il genere di cosa che si decide una
volta e poi non si rilegge più.

## Fuori perimetro

- **Correggere la riga di un altro.** Se è sbagliata, si rifà la foto.
- **Cercare una persona nell'anno** («quando lavoro con Giulia?»). Lo storage lo permetterebbe con
  dodici `Get`, ma non è la domanda che ha fatto partire questa cosa.
- **Notifiche o avvisi** su chi c'è.
- **Collegare i nomi del roster ai saldi degli Scambi.**
- **Modellare le sigle estranee.** Se un giorno si saprà cosa vale `F`, entrerà in `SHIFTS` e si
  risolverà da sola, senza toccare niente di quanto scritto qui.
