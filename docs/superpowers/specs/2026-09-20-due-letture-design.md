# Due letture, non una

Data: 2026-09-20
Stato: approvato

Segue e corregge `2026-09-20-chi-lavora-con-me-design.md`, che ha funzionato in tutto tranne che
nei tempi.

## Obiettivo

Rimettere il turnario delle colleghe, che è stato tolto dalla produzione poche ore dopo esserci
arrivato, spezzando la lettura in **due chiamate al modello** invece di una.

## Cosa è successo

Il 20 settembre la lettura da foto è passata da una riga a quindici. In produzione ogni lettura è
morta:

```
13:44 UTC (prima del deploy)   Duration:  35395 ms   → riuscita
14:19 UTC (dopo il deploy)     Duration: 120000 ms   → Status: timeout
14:21 UTC (dopo il deploy)     Duration: 120000 ms   → Status: timeout
```

Non era il parsing: la chiamata non ci arrivava. La Lambda veniva uccisa al suo tetto di 120
secondi, **prima di poter eseguire anche solo la propria gestione degli errori** — quindi niente
messaggio «scrivi i codici a mano», solo un errore generico. E ogni tentativo consumava comunque
una lettura, perché `consumePhotoQuota` viene chiamata prima del modello.

La spec precedente, il piano e la revisione finale ragionavano tutti sul **troncamento dei token**
come rischio di alzare `MAX_TOKENS`, con una via d'uscita scritta apposta. Il limite che ha morso
è il **tempo**, di cui non parlava nessuno.

## Il muro: 60 secondi

Il tetto vero non è quello della Lambda. È in `infra/lib/app-stack.ts`, sul comportamento
`/foto/*`, e il commento che lo accompagna lo diceva già da mesi:

> CloudFront caps the origin at 60 seconds and will not go higher without a quota increase.
> A reading should take 15 to 40; past 60 the viewer gets a 504.

Quindi:

| | |
|---|---|
| CloudFront, origine di `/foto/*` | **60 s** — alzabile a 180 solo con un aumento di quota AWS |
| Lambda `ReadPhoto` | 120 s |
| Lettura di una riga sola | **35 s**, misurati |
| Lettura di tutto il foglio | non finita entro 120 s |

**Questo numero decide il progetto.** La riga di lei spende già 35 dei 60 secondi disponibili: non
c'è spazio per una seconda lettura dentro la stessa richiesta, qualunque cosa si scopra misurando.
Non serve sapere quanto dura davvero la lettura dell'intero foglio per sapere che insieme non ci
stanno.

## Decisione: due richieste, la seconda automatica

La prima chiamata resta quella di oggi e non si tocca. La seconda parte da sola appena la prima è
tornata, e riempie il blocco delle colleghe quando arriva.

Un pulsante «leggi anche le colleghe» era l'alternativa, e costa meno: si paga solo quando serve.
È stata scartata perché il turnario **non è una funzione che si va a cercare** — è contesto che o
c'è quando lei guarda il calendario, o tanto vale non averlo. Un gesto in più per un dato che non
si consulta di proposito è un gesto che non si fa mai.

Il lavoro in background con polling risolverebbe il problema una volta per tutte, e toglierebbe
anche i 35 secondi di attesa che la sua lettura ha già oggi. È la risposta giusta se quella dei due
tentativi non basta: vedi *Il rischio che resta*.

## Decisione: effort basso solo per le colleghe

La chiamata 1 tiene `effort: high` e il ragionamento adattivo, perché da quella riga discendono le
ore e lo stipendio, e perché una riga letta una colonna in anticipo è il bug che quel parametro è
stato messo lì a risolvere.

La chiamata 2 gira più economica. Nessuno calcola niente sul turnario, e il prezzo — una riga
altrui più facilmente disallineata — è esattamente ciò che il checksum qui sotto intercetta.

## Decisione: la riga di lei come checksum

La chiamata 2 legge **tutto** il foglio, la riga di lei compresa. Non è una ridondanza: è la
misura.

Quella riga la chiamata 1 l'ha già letta con cura. Se la lettura economica non è d'accordo con
quella attenta **sui giorni di lei**, ha letto le colonne fuori registro — e uno scostamento di
colonna sposta tutte le righe insieme, non solo la sua. Il turnario di quella lettura si butta.

Il confronto è **esatto su tutti i giorni**, e il prezzo va detto: una singola cella ballerina
scarta l'intero turnario. L'alternativa era una tolleranza — «scarta se più di N giorni
differiscono» — ma `N` è un numero inventato, e i due guasti hanno forme diverse comunque: uno
scostamento rompe quasi tutti i giorni, un errore di lettura ne rompe uno. Il confronto esatto
sbaglia verso «nessun turnario», che è la direzione scelta, e se in pratica scarta spesso allora
quella è la prova che la lettura economica non basta — un'informazione che conviene avere subito,
non nascosta dietro una soglia.

La funzione sta in `core`, non nella Lambda: il client ha già in mano tutte e due le metà, e la
regola si prova senza rete, come `validateReading`.

## Decisione: il contatore conta le chiamate, non le foto

`MAX_READINGS_PER_DAY` passa da 10 a **20**, e il commento dice che sono dieci fogli da due
letture.

La tentazione era contare le foto e lasciare la seconda chiamata esente. Ma il contatore esiste per
una ragione sola, scritta in `photo.ts`: *«Every reading costs money... this is what stops a caller
who is already signed in»*. Se la seconda chiamata è esente, la metà cara è la metà non contata, e
chi è già autenticato può chiamare `/colleghe/leggi` in cerchio gratis. Contare le chiamate tiene
onesta la difesa. In pratica non cambia niente per lei: importa un foglio o due al mese.

## Decisione: l'immagine si rimanda, non si conserva

Il browser ha già l'immagine ridimensionata in memoria e la rimanda con la seconda richiesta. Si
pagano i token dell'immagine due volte.

L'alternativa — conservarla fra le due chiamate, su S3 o in una riga con TTL, e passarne il
riferimento — risparmierebbe un megabyte e mezzo di caricamento e qualche centesimo. È stata
scartata perché **quella foto porta i nomi e i cognomi di quattordici persone** e oggi non si posa
da nessuna parte: esiste come corpo di una richiesta e sparisce. Metterla a riposo vorrebbe dire
riscrivere la sezione *Cosa si sta conservando* della spec precedente e mantenere una politica di
retention che questo progetto non ha. Qualche centesimo non è un buon prezzo per quello.

## Codice nuovo

### `core/src/roster.ts`

```ts
/** Una riga come la restituisce la seconda lettura. */
export interface RawRow {
  readonly name: string;
  readonly row: number | null;
  readonly codes: readonly string[];
}

/** Quanto risponde la seconda lettura, già deserializzato. */
export interface SecondRead {
  readonly month: number;
  readonly year: number;
  readonly rows: readonly RawRow[];
}

/** Il turnario, oppure null quando la seconda lettura non è allineata. */
export function rosterFromSecondRead(
  reading: PhotoReading,
  second: SecondRead,
): MonthRoster | null;
```

Il mese e l'anno vengono dalla `reading` già validata, e quelli della `second` servono solo a
essere confrontati: due fonti per lo stesso mese possono trovarsi in disaccordo, ed è proprio
quello che si vuole sapere. Se non combaciano, `null`.

Fa quattro cose, in quest'ordine:

1. **Trova la riga di lei** fra le `rows`, confrontando il nome normalizzato da
   `normaliseColleague`, senza distinzione di maiuscole, prima contro `reading.foundName` e poi
   contro `ROW_NAME`. Se più righe combaciano vince la prima: sono due righe del foglio, e
   sceglierne una vale quanto sceglierne l'altra quando il confronto che segue le boccerebbe
   entrambe. Se non ne combacia nessuna, `null` — senza la sua riga non c'è misura, e un turnario
   non misurato non si salva.
2. **La confronta giorno per giorno** con `reading.days`. Il confronto è fra forme normalizzate:
   il `code: null` della prima lettura e la stringa vuota della seconda sono la stessa cosa, e le
   sigle della seconda passano da `normaliseCode` prima del paragone. Una sola differenza basta.
3. **Esclude la sua riga** dal turnario.
4. **Normalizza le altre** con le regole che ci sono già — `validateRoster`, i tetti su nome e
   numero di persone, l'esclusione di lei — che questa funzione usa e non riscrive.

`validateRoster`, `normaliseCode`, i tetti su nome e persone e l'esclusione di lei restano quelli
che sono: questa funzione li usa, non li riscrive.

### `api/src/vision.ts`

Una seconda `Vision` accanto alla prima, con il proprio prompt e il proprio schema — non un
parametro `mode` sulla stessa. I due prompt hanno scopi diversi e cambieranno per ragioni diverse,
e tenerli separati è ciò che impedisce a una modifica per le colleghe di toccare la riga da cui
esce lo stipendio.

### `api/src/handlers.ts`

`readRoster`, sulla falsariga di `readPhoto`: verifica il token, consuma il contatore, chiama il
modello, valida la forma, risponde `{ month, year, rows }`. Il checksum **non** sta qui.

### `core/src/photo.ts`

`others` esce da `READING_SCHEMA`. La chiamata 2 ha il suo schema, quindi quella proprietà è morta
— e un campo che il prompt non nomina è un invito a riempirlo.

## L'infrastruttura

Una `NodejsFunction` nuova, `ReadRoster`, accanto a `ReadPhoto`: stesso file di ingresso, proprio
handler, proprio log group, `timeout` 120 s, `memorySize` 512, `reservedConcurrentExecutions` 2.
Verifica il token da sé, come `ReadPhoto`, perché una Function URL non prende un autorizzatore.
Prende `grantReadWriteData` perché scrive il contatore.

Un comportamento CloudFront nuovo, `/colleghe/*`, con `readTimeout: 60` come `/foto/*`. L'endpoint
è `/colleghe/leggi` e non `/colleghe` nudo, per la ragione che il commento esistente dà già per
`/foto/leggi`: il `*` combacia **dopo** il letterale, quindi un percorso nudo cade sul bucket del
sito e viene rifiutato al bordo.

Le rotte di API Gateway restano sette: queste sono Function URL, non rotte. Il test che conta le
Lambda per nome di handler va allargato con `readRoster`.

**Una funzione separata e non un parametro sulla stessa**, perché `ReadPhoto` ha
`reservedConcurrentExecutions: 2`: due chiamate per foto sulla stessa funzione vorrebbero dire che
un singolo import la satura, e una lettura lenta delle colleghe bloccherebbe il suo import
successivo. Il percorso veloce resta indipendente da quello lento.

## Gli errori finiscono tutti allo stesso modo

Cinque cose possono andare storte nella chiamata 2: il 504 di CloudFront a 60 secondi, un
`VisionFailed`, una forma non valida, un checksum fallito, il contatore esaurito.

**Producono tutte la stessa riga in italiano**: le colleghe non si sono lette questa volta, i suoi
turni non ne risentono. Nessuna di esse porta a un gesto diverso — si riprova, o si fa senza. Le
distinzioni restano nei log della Lambda, dove sono diagnostica e non rumore.

**Il salvataggio non è mai bloccato dalla chiamata 2.** È il senso della divisione: la sua griglia
è sullo schermo e modificabile a 35 secondi, mentre la seconda lettura è ancora in volo. Il
gestore del salvataggio mantiene la forma che ha già: prima i turni, poi il turnario se c'è. Se
non è ancora arrivato, non si salva niente di più. Se arriva un momento dopo, premere salva di
nuovo è sicuro e ovvio: i turni si riscrivono identici e il turnario sostituisce il mese.

## La schermata

Sotto la griglia, dove il blocco del turnario sta già: *«Leggo anche le colleghe…»* mentre la
chiamata 2 è in volo, sostituito o dal blocco richiudibile «lette N persone» o dalla riga di
fallimento. Tutto il resto — il blocco, l'occhiata, l'ordine di salvataggio — è quello che è già
stato costruito e non cambia.

## Test

In `core`, dove sta il rischio:

- `rosterFromSecondRead`: combacia → turnario; una cella diversa → `null`; una riga intera
  spostata di una colonna → `null`; la riga di lei non finisce mai in `people`; le sigle ignote
  sopravvivono; mese diverso → `null`; la riga di lei assente dalle `rows` → `null`.

In `api`:

- il nuovo handler consuma lo stesso contatore, pretende il token, traduce `VisionFailed` e una
  forma non valida in 422.

In `web`:

- la riga di attesa, la riga di fallimento, il salvataggio con e senza turnario presente.

In `infra`:

- la funzione nuova, il comportamento nuovo, e che `ReadRoster` scrive mentre le Lambda di sola
  lettura continuano a non scrivere.

## Il rischio che resta

**Non sappiamo quanto dura la chiamata 2.** Le due letture in produzione sono state troncate a 120
secondi, quindi «più di 120» è tutto ciò che si sa — e quella era la lettura intera a effort alto,
non la lettura compatta a effort basso che questo progetto propone.

Se la chiamata 2 non sta nei 60 secondi di CloudFront, **questo progetto non funziona** e la
risposta è il lavoro in background con polling, scartato più sopra. La misura va presa prima di
scrivere il codice, con `api/test/vision.integration.test.ts`, che gira contro Bedrock vero e
bypassa la Lambda:

```bash
PROVA_BEDROCK=1 \
  FOTO_LUGLIO=~/vanessa-foto/luglio.jpeg \
  FOTO_AGOSTO=~/vanessa-foto/agosto.jpeg \
  npx vitest run --root api api/test/vision.integration.test.ts
```

Un margine sottile conta come fallimento: 55 secondi su un tetto di 60 non è un progetto, è una
coincidenza che aspetta una foto più grande.

## Fuori perimetro

- **Alzare il tetto di CloudFront a 180 secondi.** Richiede un aumento di quota ad AWS, e tre
  minuti di clessidra non sono comunque una schermata.
- **Correggere la riga di un'altra persona.** Come prima: si rifà la foto.
- **Il lavoro in background**, a meno che la misura non lo imponga.
- **Conservare l'immagine** fra le due chiamate.
