# Import dei turni da una foto del foglio

Data: 2026-08-02
Stato: approvato

## Obiettivo

Vanessa riceve su WhatsApp la foto del foglio affisso in reparto: gliela manda una collega, non
la scatta lei. Quando apre l'app la foto ce l'ha gia' in galleria. Oggi ricopia i codici a mano nella
vista **Carica**, un mese alla volta. L'import legge la foto, ne estrae la sua riga e presenta
i giorni già compilati, da correggere e salvare.

Il lavoro manuale non sparisce: si sposta dal digitare trentuno codici al correggerne uno o due.

## Le due foto di riferimento

**Non entrano nel repository.** `hpfs74/vanessa-shift` è pubblico, e le due foto riportano il
nome e cognome di quattordici colleghe accanto ai loro turni, più il nome e l'indirizzo della
struttura. Non sono dati di Vanessa e nessuna delle persone riprese ha acconsentito a
pubblicarli; la cronologia di git non si ripulisce.

Restano quindi su disco, fuori dal repository. Il test di integrazione le trova tramite
`FOTO_LUGLIO` e `FOTO_AGOSTO`, e si salta da solo se le variabili non ci sono — è già dietro
`PROVA_BEDROCK=1`, quindi lo esegue solo chi ha le foto in mano. Le tabelle qui sotto sono la
trascrizione delle righe che servono, e bastano a scrivere tutti gli altri test.

| File | Cos'è | Riga di Vanessa | Contenuto della riga |
|------|-------|-----------------|----------------------|
| `luglio.jpeg` | fotografia di un foglio di carta, con correzioni a penna, cerchiature e cancellature su altre righe | 14, evidenziata in verde | `x` dal giorno 1 al 16, poi `M M P L P M M M L P M M M L P` dal 17 al 31 |
| `agosto.jpeg` | fotografia di uno schermo con il foglio Excel aperto | 12 | mese intero: `L M M M P L M L M P1 L M P M P M1 L M P L M P M P L M P M P L M` |

Due cose che i due esempi rendono obbligatorie:

- **la riga può iniziare a mese avviato.** Le `x` di luglio non sono turni: sono giorni in cui
  Vanessa non era in servizio. Un import posizionale che ignori le celle vuote sposterebbe
  quindici turni indietro di sedici giorni.
- **i codici sul foglio sono esattamente quelli dell'app.** `L`, `M`, `M1`, `P`, `P1` — nessuna
  sigla nuova da modellare. Le altre lettere che compaiono nella griglia (`F`, `R`, `C`, `N1`,
  `P1` di altre righe) appartengono a colleghe con mansioni diverse e non riguardano questa riga.

## Decisione: quanto costa, e chi paga

L'API è aperta per scelta documentata in `2026-08-02-web-app-aws-design.md`. Finora un abuso
costava una scrittura DynamoDB; un endpoint che legge foto costa **circa 0,08–0,10 € a
chiamata** (l'immagine vale fino a ~4.800 token visivi, più il ragionamento e un output breve).

La difesa scelta, senza password:

- **immagine ridimensionata sul telefono** a 2576px sul lato lungo — il massimo che il modello
  usa comunque — quindi niente da guadagnare a spedire foto enormi;
- **tetto giornaliero di 10 letture**, contatore atomico su DynamoDB; oltre il tetto la risposta
  è 429 fino al giorno dopo. Il contatore si incrementa **prima** della chiamata a Bedrock e non
  si restituisce se la chiamata fallisce: altrimenti chi abusa ottiene tentativi gratis proprio
  facendo fallire la lettura. Vanessa lo paga come una lettura persa su dieci al giorno;
- **rifiuto a monte dei corpi oltre 2 MB**, prima di spendere qualsiasi cosa: un'immagine
  ridimensionata come si deve ne pesa meno di uno;
- **concorrenza riservata a 2** sulla Lambda, che è il freno al parallelismo;
- allarme di budget su AWS.

Nel caso peggiore l'abuso costa circa 1 € al giorno. Vanessa ne fa due al mese.

Una password condivisa è stata considerata e scartata: salvata nel browser e leggibile negli
strumenti di sviluppo, non è autenticazione, e aggiungerebbe attrito a chi usa l'app davvero
senza fermare chi la vuole abusare.

## Decisione: Lambda Function URL, non API Gateway

> Superata in parte da `2026-08-02-api-dietro-cloudfront-design.md`: la Function URL c'è ancora,
> ma il browser non la chiama più per nome — passa da `/foto/leggi` sulla distribuzione, e
> `.env.production` non esiste più. Il tetto di CloudFront è 60 secondi, e una lettura ne prende
> fra i 18 e i 25.

API Gateway HTTP API tronca l'integrazione a **30 secondi**. Una lettura con il ragionamento
attivo ne prende fra i 18 e i 25: troppo vicino al taglio.

Questa rotta — e solo questa — sta dietro una **Lambda Function URL**, che non ha quel limite.
Conseguenze accettate:

- un secondo indirizzo pubblico (poi nascosto dietro CloudFront, vedi il riquadro sopra);
- CORS configurato sulla Function URL invece che su API Gateway;
- niente throttling di API Gateway su questa rotta: il freno sono la concorrenza riservata e il
  tetto giornaliero, che per un endpoint costoso sono difese più pertinenti di 100 req/s.

Le cinque rotte esistenti non si toccano.

## Il modello

**Claude Sonnet 4.6 su Amazon Bedrock**, attraverso il profilo di inferenza cross-region
`eu.anthropic.claude-sonnet-4-6`, in `eu-south-1`. Client: `@anthropic-ai/bedrock-sdk`,
`AnthropicBedrock({ awsRegion: 'eu-south-1' })`.

Bedrock e non l'API diretta di Anthropic perché **non c'è nessuna chiave da conservare né da
ruotare**: la Lambda ottiene il permesso via IAM, coerentemente con il resto dello stack, che
non ha un solo segreto in giro.

### Come ci si è arrivati, perché non si ripeta

La prima stesura diceva «Claude Opus 5, `anthropic.claude-opus-5`, in `eu-south-1`, verificata
disponibile». Era sbagliata in tre modi, e sono costati tre deploy falliti prima che il primo
foglio venisse letto.

- **La verifica era sull'API sbagliata.** `aws bedrock list-foundation-models` elenca
  `anthropic.claude-opus-5` in `eu-south-1` senza fare una piega, ed è quello che avevo
  guardato. Ma elenca i modelli della vecchia API `InvokeModel`, non quelli dell'endpoint
  Messages (`AnthropicBedrockMantle`) su cui era scritto il codice — e quell'endpoint, in
  `eu-south-1`, non serve **nessun** modello: ogni identificatore risponde «the model does not
  exist». Il modo per saperlo è chiamare l'endpoint e leggere quale dei due errori torna:
  `not_found_error` vuol dire che l'identificatore non lo conosce, `permission_error` che lo
  conosce e non te lo fa eseguire.
- **Opus non è abilitato su questo account.** `eu.anthropic.claude-opus-4-8` risponde «not
  available for this account»: è un accesso da concedere in console, non una cosa che il codice
  possa aggiustare. Sonnet lo è.
- **E il permesso IAM non era quello ovvio.** L'endpoint Messages non passa da
  `bedrock:InvokeModel` ma da `bedrock-mantle:CreateInference` su una risorsa progetto. Sulla
  vecchia API, che è quella in uso adesso, serve `bedrock:InvokeModel` su due risorse: il
  profilo `eu.` e il modello nella regione in cui il profilo instrada.

Prima di usare il modello, l'account deve avere fatto due passi distinti in console: il modulo
dei casi d'uso Anthropic **e** l'accettazione dell'accordo sul modello. Il primo senza il
secondo lascia `agreementAvailability: NOT_AVAILABLE`, e ogni chiamata torna 404 «Model use
case details have not been submitted», che è un messaggio fuorviante: il modulo è stato inviato,
manca l'accordo. `aws bedrock get-foundation-model-availability` dice quale dei due manca.

### Parametri

- **ragionamento adattivo** ed `effort: high`. Non è un lusso: senza, sulla foto di luglio il
  modello leggeva tutti e quindici i codici correttamente e li posava una colonna troppo a
  sinistra — primo turno il 16 invece del 17, tutti i giorni successivi spostati, il 31 caduto
  fuori — e marcava ogni cella come sicura, quindi la griglia sarebbe arrivata a schermo senza
  una sottolineatura. Contare trentuno colonne su un foglio fotografato storto non è un colpo
  d'occhio. Con il ragionamento attivo entrambe le foto passano.
- `max_tokens` 8000. Il tetto vale per ragionamento **più** risposta insieme: stretto, tronca a
  metà.
- `output_config.format` con lo schema qui sotto, così il modello non può restituire una forma
  che il codice non sa leggere.

Costo misurato: una lettura sta fra i 18 e i 25 secondi.

## Il contratto di estrazione

```ts
{
  month: 7,
  year: 2026,
  found: true,
  foundName: "Vanessa",
  foundRow: 14,
  days: [
    { day: 1,  code: null, confident: true },
    { day: 17, code: "M",  confident: true },
    …
  ]
}
```

Regole, verificate in `core` e non nella Lambda:

- `days` copre **esattamente** 1…giorni del mese, senza buchi e senza duplicati;
- `code` è uno fra `L M M1 P P1`, oppure `null`;
- `month` fra 1 e 12, `year` entro un anno dall'attuale;
- se una qualsiasi di queste salta, l'estrazione è respinta **per intero**. Mezza griglia
  plausibile è peggio di un errore: si salva senza accorgersene.

**`code: null` significa «sul foglio non c'è un turno»** — le `x` di luglio, una cella vuota,
una cella illeggibile. Sono la stessa cosa ai fini del salvataggio.

**`confident: false` è un suggerimento, non un verdetto.** Serve a sottolineare la cella nella
griglia. Tutte le celle restano modificabili, comprese quelle che il modello dà per certe.

Il nome della riga è la costante `ROW_NAME = 'Vanessa'` in `core`, passata al prompt. Se la
riga non si trova, è un errore esplicito, non un'estrazione vuota.

Mese e anno si leggono dal titolo del foglio — entrambe le foto ce l'hanno, `LUGLIO 2026` e
`…AGOSTO 2026` — e restano correggibili a schermo.

## Flusso

```
telefono  →  ridimensiona (canvas, lato lungo 2576px, JPEG q 0.85)
          →  POST /foto/leggi  { image: base64 }
                 │
                 ├─ corpo oltre 2 MB → 413, senza toccare quota né Bedrock
                 │
                 ├─ quota:  pk=QUOTA#FOTO  sk=2026-08-02
                 │          ADD count 1  IF count < 10   → altrimenti 429
                 │
                 ├─ Bedrock: immagine + prompt + schema
                 │
                 └─ core: valida  →  { month, year, days[] }
          →  griglia modificabile  →  planChanges  →  PUT /shifts  (rotta esistente)
```

**L'endpoint di lettura non scrive mai un turno.** Costa e può sbagliare: restituisce dati e si
ferma. Il salvataggio resta su `PUT /shifts`, che ha già la revisione e la tabella di quello che
verrebbe sovrascritto. L'unica scrittura che fa è il contatore della quota.

**I giorni con `codice: null` non si salvano e non cancellano un turno già presente.** Una foto
può essere tagliata, una riga può iniziare a mese avviato: cancellare è l'unica cosa senza
ritorno, e non la si fa mai su deduzione.

L'immagine non si conserva: viene elaborata e scartata. Non finisce su S3 né in tabella.

## Codice nuovo

| Dove | Cosa |
|------|------|
| `core/src/foto.ts` | La forma dell'estrazione, la sua validazione, la conversione in `ParsedEntry[]`. Puro: niente AWS, niente HTTP. |
| `api/src/visione.ts` | La chiamata a Bedrock: prompt, blocco immagine, schema, lettura della risposta. Una funzione, un compito, sostituibile nei test. |
| `api/src/quota.ts` | Il contatore giornaliero atomico, con TTL sulle righe vecchie. |
| `api/src/handlers.ts` | `leggiFoto`: quota → visione → validazione → JSON. |
| `web/src/PhotoImport.tsx` | Scelta della foto, ridimensionamento, griglia modificabile. |
| `web/src/BulkEntry.tsx` | Rifattorizzazione: la tabella del piano e il pulsante di salvataggio diventano `<PianoSalvataggio>`, condiviso fra la sequenza scritta a mano e la foto. Entrambe producono già `ParsedEntry[]`. |
| `infra/lib/app-stack.ts` | Lambda `LeggiFoto`, Function URL, permesso Bedrock, scrittura in tabella, concorrenza riservata 2, timeout 120s. |

`parseSequence` non si tocca: resta il percorso di chi scrive a mano, e resta posizionale.
La foto produce voci già numerate per giorno, che è ciò che `planChanges` e `saveShifts`
accettano da sempre.

Gli identificativi dei construct CDK restano in italiano, come già documentato in
`app-stack.ts`: rinominarli distrugge la risorsa.

## La schermata

Dentro **Carica**, che è già il posto dove si riempie un mese intero.

```
Caricamento rapido
┌──────────────────────────────┐
│  📷  Leggi da una foto        │   input file, accept=image/* e nient'altro
└──────────────────────────────┘
   oppure scrivi i codici a mano ↓
   [ textarea esistente ]
```

A lettura riuscita la griglia prende il posto della textarea, con `← scrivi a mano` per tornare
indietro:

```
LUGLIO 2026        riga trovata: Vanessa (14)     [ ripeti ]

 lu ma me gi ve sa do
                     1  2       allineata ai giorni della settimana, come Calendario
  3  4  5  6  7  8  9
  -  -  -  -  -  -  -
 …
 14 15 16 17 18 19 20
  -  -  -  M  M  P  L           il 17 è dove la riga comincia
 …
                                le celle con sicuro:false hanno la sottolineatura tratteggiata

15 giorni nuovi · 0 da sovrascrivere · 16 senza turno
[ tabella dei giorni che verrebbero sovrascritti ]
              [ Salva 15 giorni ]
```

Toccare una cella apre lo stesso pannello dal basso che usa già `DayEditor`: i cinque codici più
*nessun turno*. Target da 44px, input a 16px, come il resto dell'app.

## Errori

| Caso | Messaggio |
|------|-----------|
| Riga non trovata | «Non ho trovato la riga di Vanessa in questa foto. Controlla che si veda tutta la riga, dal nome fino all'ultimo giorno.» |
| Foto illeggibile, o schema non valido | «Non sono riuscito a leggere questo foglio. Prova con più luce, o scrivi i codici a mano.» |
| Quota esaurita (429) | «Hai già usato le 10 letture di oggi. Riprova domani, oppure scrivi i codici a mano.» |
| Bedrock in errore o lento | «Il servizio non risponde. Riprova fra un minuto.» |

Ognuno finisce con una via d'uscita, e la textarea è sempre a un tocco: la foto non diventa mai
l'unico modo per entrare.

## Test

- **`core/test/foto.test.ts`** — validazione pura: payload valido; giorno mancante; giorno
  duplicato; giorno 32; codice `P2`; mese 13; anno lontano; payload a forma di luglio con
  sedici `null` che si converte in esattamente quindici `ParsedEntry`, il primo al giorno 17.
- **`api/test/quota.test.ts`** — sotto il tetto, al tetto, oltre il tetto, e due chiamate
  contemporanee al confine: la scrittura condizionale ne deve far passare esattamente una.
- **`api/test/handlers.test.ts`** — `leggiFoto` con `visione` sostituita: caso felice, 429,
  corpo oltre 2 MB respinto senza toccare né quota né Bedrock, Bedrock che solleva, modello che
  restituisce qualcosa che non supera la validazione. E il caso che tiene in piedi la regola
  sopra: quando Bedrock solleva, il contatore resta incrementato.
- **`web/test/photoImport.test.tsx`** — data un'estrazione fissa: la griglia si disegna, le celle
  incerte sono segnate, modificare il giorno 23 cambia il piano, i giorni `null` non compaiono
  fra quelli salvati.
- **`api/test/visione.integrazione.test.ts`** — le due foto vere contro Bedrock vero, dietro
  `PROVA_BEDROCK=1` più `FOTO_LUGLIO` e `FOTO_AGOSTO` che puntano ai file su disco; se mancano,
  si salta. Asserisce i trentuno codici di agosto e i quindici di luglio dal giorno 17. Fuori
  dalla CI: non ci sono credenziali, costa, e le foto non stanno nel repository. Serve a
  verificare una modifica al prompt con un comando invece che a occhio.

## Fuori perimetro

Niente foto con più mesi. Niente lettura delle righe delle colleghe. Niente conservazione
dell'immagine. Nessun ripiego OCR locale quando Bedrock non risponde. Sono funzionalità
legittime; nessuna è questa.
