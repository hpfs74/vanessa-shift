# Web app AWS — turni e stipendio

Data: 2026-08-02
Stato: approvato

## Obiettivo

Sostituire il foglio di calcolo con una web app. Vanessa inserisce i turni dal telefono, vede
il calendario mensile e la simulazione dello stipendio. Il foglio smette di essere la fonte di
verità; il generatore Python resta nel repository per un'esportazione occasionale.

Indirizzo: `https://vanessa.matteo.cool`
Account AWS: `495133941005`. Regione: `eu-south-1` (Milano); il certificato CloudFront in
`us-east-1` perché CloudFront non ne accetta altrove.

## Decisione deliberata: nessuna autenticazione

L'app e l'API sono aperte. Chiunque conosca l'indirizzo può leggere e modificare i turni e i
parametri dello stipendio. È una scelta esplicita del proprietario, presa dopo che il rischio è
stato illustrato: i dati sono personali (turni e retribuzione) e un endpoint di scrittura
pubblico viene trovato dagli scanner automatici.

Conseguenze accettate, scritte qui perché restino agli atti:

- chiunque può alterare i dati, e non c'è modo di sapere chi;
- non esiste protezione contro la cancellazione di massa;
- i costi DynamoDB e Lambda sono esposti al traffico di terzi.

Mitigazioni comunque incluse, perché costano poco e non aggiungono attrito:

- throttling su API Gateway (100 richieste al secondo, burst 200);
- DynamoDB in modalità on-demand con allarme di budget;
- point-in-time recovery attivo sulla tabella, per poter tornare indietro dopo un danno.

Passare a Cognito in seguito richiede di aggiungere un authorizer e una schermata di login: non
richiede di rifare né il modello dati né l'infrastruttura.

## Architettura

Monorepo con tre pacchetti indipendenti:

| Pacchetto | Contenuto |
|-----------|-----------|
| `app/core/` | logica di dominio pura: codici turno, ore, festivi, ripartizione, stipendio |
| `app/api/` | handler Lambda, in TypeScript |
| `app/infra/` | CDK in TypeScript |
| `app/web/` | React + Vite + TypeScript |

`core` non importa nulla da AWS e non conosce HTTP: è la stessa logica che oggi vive nel
generatore Python, portata in TypeScript e condivisa fra `api` e `web`. Il frontend la usa per
calcolare le ore mentre si digita, senza andare in rete; il backend la usa per non fidarsi di
quello che arriva dal client.

## Modello dati

Una sola tabella DynamoDB, on-demand, point-in-time recovery attivo.

| Entità | `pk` | `sk` | Attributi |
|--------|------|------|-----------|
| Turno del giorno | `TURNI#2026` | `2026-01-15` | `cod`, `codOrig`, `collega`, `tipoScambio`, `note` |
| Parametri paga | `CONFIG` | `PAGA` | `tariffaOraria`, `maggSabato`, `maggDomenica`, `maggFestivo`, `rateo13a`, `coeffNetto` |

Un mese si legge con `Query` su `pk = "TURNI#2026"` e `begins_with(sk, "2026-01")`.

**Le ore non si memorizzano.** Si derivano dal codice turno tramite la tabella dei codici, come
nel foglio: un solo posto dove cambiano, e nessun dato che può andare fuori sincrono con sé
stesso.

Un giorno senza turno non esiste come item. L'assenza è l'assenza, non una riga vuota.

## API

API Gateway HTTP API, quattro Lambda Node.js 22, una per rotta:

| Rotta | Lambda | Comportamento |
|-------|--------|---------------|
| `GET /shifts?from=YYYY-MM-DD&to=YYYY-MM-DD` | `getShifts` | i turni nell'intervallo; intervallo massimo un anno |
| `PUT /shifts/{date}` | `putShift` | scrive o sostituisce un giorno; `cod` vuoto cancella l'item |
| `GET /config` | `getConfig` | i parametri paga, o i default se non esistono |
| `PUT /config` | `putConfig` | scrive i parametri |

Validazione dell'input in ogni handler: data in formato ISO e realmente esistente, codice fra
quelli previsti, percentuali fra 0 e 1, tariffa non negativa. Un input non valido riceve `400`
con un messaggio, non un `500`.

CORS limitato all'origine `https://vanessa.matteo.cool`.

## Frontend

React con Vite, TypeScript. Tre viste:

1. **Calendario** — la griglia mensile, stessa disposizione del foglio: lunedì-domenica, colore
   per turno, colore per sabato, domenica e festivo, ore della settimana a lato, totale del mese.
2. **Inserimento** — si tocca un giorno e si sceglie il codice. Ottimistico: la cella cambia
   subito, la chiamata parte dopo; se fallisce, la cella torna indietro e compare l'errore.
3. **Stipendio** — i parametri e la tabella mensile, con la stessa regola del foglio: nessuna
   cifra in euro finché il parametro da cui dipende non è compilato.

Distribuzione: bucket S3 privato, CloudFront con Origin Access Control, certificato ACM,
record A in Route53. Le rotte del client sono servite riscrivendo i 404 su `index.html`.

## Test

Unit su tutti e tre i pacchetti. Niente end-to-end, per scelta.

- `core` — i casi limite già verificati nella versione Python: `P` vale 7 ore e `P1` ne vale 8;
  la Pasqua sull'algoritmo gregoriano; la Pasquetta che coincide con il 25 aprile e non va
  contata due volte; la ripartizione delle ore che assegna ogni ora a esattamente una categoria
  con precedenza festivo, domenica, sabato; gli importi che restano vuoti finché mancano i
  parametri, totali annuali compresi.
- `api` — ogni handler con input valido, input malformato e tabella vuota; DynamoDB simulato,
  nessuna chiamata di rete nei test.
- `infra` — asserzioni CDK: la tabella ha point-in-time recovery, il bucket non è pubblico,
  CloudFront usa OAC, il certificato è in `us-east-1`, il throttling è impostato.
- `web` — i componenti di calcolo e la resa del calendario; nessun test che dipenda dalla rete.

## Ordine di consegna

Ogni fase è deployabile e lascia l'app funzionante.

1. **Scheletro** — CDK, tabella, una Lambda, API Gateway, React su CloudFront, dominio,
   certificato. Feature minima: scrivere un codice su un giorno e rileggerlo.
2. **Calendario e turni** — la griglia mensile completa e l'inserimento.
3. **Stipendio** — parametri e tabella mensile.
4. **Scambi** — colleghe, saldo favori e saldo ore.

## Fuori scopo

- Autenticazione (decisione esplicita, vedi sopra)
- Test end-to-end
- Sincronizzazione con il foglio di calcolo: la app è la fonte di verità
- Applicazione nativa; è una web app, usabile dal browser del telefono
- Multi-utente: i dati sono di una persona sola, senza partizionamento per utente
