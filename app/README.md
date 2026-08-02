# Turni di Vanessa — web app

Sostituisce il foglio di calcolo. In linea su **https://vanessa.matteo.cool**.

## Pacchetti

| Cartella | Cosa contiene |
|----------|---------------|
| `core/` | logica di dominio pura: codici turno, ore, festivi, ripartizione, importi. Nessuna dipendenza da AWS o da HTTP. |
| `api/` | i quattro handler Lambda e l'accesso a DynamoDB |
| `infra/` | CDK: tabella, Lambda, API Gateway, S3, CloudFront, certificato, DNS |
| `web/` | React + Vite |

`core` è condiviso fra `api` e `web`: il frontend calcola le ore mentre si digita senza andare
in rete, il backend usa la stessa logica per non fidarsi di quello che arriva dal client.

## Comandi

```bash
npm install          # dalla cartella app/
npm test             # tutti e quattro i pacchetti
npm run typecheck
npm run build        # compila il frontend
npm run deploy       # build + cdk deploy
```

Deploy della sola infrastruttura:

```bash
cd infra && npx cdk deploy --all --require-approval never
```

## Viste

| Vista | Cosa fa |
|-------|---------|
| **Calendario** | griglia mensile, CRUD completo del giorno: turno, turno originale, collega, tipo di scambio, note. Il puntino accanto al codice segnala uno scambio. |
| **Carica** | leggi il mese da una foto del foglio, oppure scrivi la sequenza dei codici. In entrambi i casi mostra quali giorni sovrascriverebbe **prima** di salvare. |
| **Scambi** | saldo favori e saldo ore per collega, come il foglio Scambi. |
| **Riepilogo** | due grafici ad anello (ore per turno, giorni per codice), ore per mese a barre, tabella per codice. |
| **Stipendio** | parametri e simulazione mensile. |

## Ore effettive

Le ore si derivano dalla sigla del turno, ma ogni singolo giorno può essere corretto a mano:
`M` vale 6 ore, e se quel giorno se ne sono fatte 4 si scrive 4. Il campo vuoto significa
«come da contratto»; uno **zero** è una risposta vera (entrata e rimandata a casa), non un
campo lasciato in bianco, e viene conservato come tale.

Il giorno corretto a mano si riconosce nel calendario: al posto dell'orario compare il
numero di ore, sottolineato tratteggiato. La correzione entra ovunque — ore della
settimana, totali del mese, riepilogo, simulazione stipendio e differenza ore degli scambi.

**Su questo l'app si discosta dal foglio Excel**, che deriva sempre le ore dalla sigla e non
ha un campo per l'eccezione: sugli stessi dati i due possono dare totali diversi.

## Colori dei grafici

Gli spicchi **non** usano le tinte pastello delle celle del calendario. Quelle funzionano
come sfondo dietro una sigla leggibile, ma come spicchi sono indistinguibili: il validatore
misura la coppia peggiore a ΔE 4.9 per la vista normale, cioè illeggibile anche senza
alcun deficit cromatico.

I quattro colori in uso passano tutti i controlli sulla superficie chiara, confrontati su
**tutte** le coppie e non solo su quelle adiacenti, perche' in un anello ogni spicchio
confina con ogni altro. Il giallo e' stato scartato: contro l'arancio sta a ΔE 13.7, sotto
la soglia di 15.

L'identita' non dipende comunque dal colore: ogni spicchio ha una riga di legenda con la
sigla del turno, ed e' la sigla — non il colore — a legarlo al calendario.

L'app dichiara `color-scheme: light` e non ha un tema scuro. Se un giorno lo si aggiunge,
questi valori vanno ricalcolati per la superficie scura e rivalidati: capovolgerli non
supera il controllo.

## Mobile first

L'app si usa dal telefono. Navigazione in basso dove arriva il pollice, target di tocco da
44px, i pannelli di modifica salgono dal basso, gli input a 16px perché Safari iOS non
faccia lo zoom quando prendono il fuoco, e le tabelle scorrono da sole invece di far
scorrere la pagina in orizzontale.

## Import da foto

Vanessa fotografa il foglio affisso in reparto e l'app ne legge la sua riga.
La foto viene ridimensionata sul telefono a 2576px di lato lungo — il massimo
che il modello usa comunque — e spedita a una Lambda che chiede a Claude Opus 5
su Bedrock quali sigle ci sono nella riga intestata a Vanessa.

L'endpoint di lettura **non scrive nessun turno**: restituisce una griglia, che
si corregge a schermo e si salva con la stessa rotta della sequenza scritta a
mano, revisione compresa. I giorni senza codice — le `x` di un mese iniziato a
metà — non si salvano e non cancellano niente.

Sta dietro una **Lambda Function URL** e non dietro API Gateway, che tronca
l'integrazione a 30 secondi: una lettura ne può prendere di più. L'indirizzo è
l'output `PhotoUrl` dello stack e va in `web/.env.production` come
`VITE_PHOTO_URL` prima di ricompilare il frontend. Finché è vuoto il pulsante lo
dice — «la lettura da foto non è configurata su questa installazione» — invece di
chiamare un indirizzo che non esiste e mostrare l'errore del browser.

Ogni lettura costa circa 0,09 €, su un'API che resta aperta. Le difese sono un
**tetto di 10 letture al giorno** (contatore su DynamoDB, condizione e
incremento nella stessa operazione), la concorrenza riservata a 2, e il rifiuto
dei corpi oltre 2 MB. Il contatore si consuma **prima** della chiamata e non si
restituisce se la chiamata fallisce: altrimenti basta far fallire la lettura per
avere tentativi gratis.

Le foto di prova non stanno nel repository — è pubblico, e riportano nome e
cognome di quattordici colleghe accanto ai loro turni. Il test che le usa si
salta da solo:

```bash
PROVA_BEDROCK=1 FOTO_LUGLIO=~/vanessa-foto/luglio.jpeg \
  FOTO_AGOSTO=~/vanessa-foto/agosto.jpeg \
  npx vitest run --root api api/test/vision.integration.test.ts
```

## Risorse AWS

Account `495133941005`, regione `eu-south-1`. Il certificato sta in `us-east-1` perché
CloudFront non ne accetta altrove: da qui i due stack.

| Stack | Contenuto |
|-------|-----------|
| `VanessaCertificato` | certificato ACM (us-east-1) |
| `VanessaApp` | tabella, Lambda, API, bucket, distribuzione, record DNS |

L'endpoint dell'API sta in `web/.env.production`. Se lo stack viene ricreato l'endpoint cambia
e va aggiornato lì prima di ricompilare il frontend.

## Deploy automatico

Ogni push su `main` lancia `.github/workflows/deploy.yml`: test, typecheck, build e
`cdk deploy`, poi verifica che sito e API rispondano davvero 200. Sulle pull request
girano solo i test. Il deploy si puo' anche lanciare a mano da GitHub (*Run workflow*).

**Non ci sono credenziali AWS su GitHub.** La pipeline si autentica via OIDC: chiede ad AWS
un token temporaneo a ogni esecuzione. Niente da ruotare, niente da revocare.

| Risorsa | Cosa fa |
|---------|---------|
| OIDC provider `token.actions.githubusercontent.com` | permette a GitHub di farsi riconoscere da AWS |
| Ruolo `vanessa-shift-deploy` | assumibile **solo** da `repo:hpfs74@5243150/vanessa-shift@1319134106:environment:produzione` |

Il `sub` porta gli **ID numerici** di utente e repository, non i loro nomi: e' la forma che
GitHub emette oggi ed e' piu' solida, perche' rinominare il repository non permette a
nessun altro di ereditarne l'accesso. Un jolly scritto sui nomi non combacerebbe mai.

Il job dichiara `environment: produzione`, e in quel caso il `sub` finisce con
`:environment:produzione` invece che con `:ref:refs/heads/main`. L'ambiente su GitHub e'
a sua volta limitato al solo branch `main`, quindi le due protezioni concordano.

Il ruolo non e' amministratore: puo' solo assumere i ruoli che il bootstrap CDK ha creato
nelle due regioni usate, e leggere gli output dei due stack di questo progetto. Un altro
repository, o un altro branch di questo, non riesce ad assumerlo.

Se il repository viene ricreato da zero (non rinominato: gli ID restano), la condizione di
trust va aggiornata con i nuovi ID, altrimenti il deploy smette di funzionare — di proposito.

## Nessuna autenticazione

Scelta deliberata del proprietario, documentata in
`docs/superpowers/specs/2026-08-02-web-app-aws-design.md`. L'API è aperta: chiunque conosca
l'indirizzo può leggere e modificare turni e parametri.

Le uniche difese attive sono il throttling su API Gateway (100 richieste al secondo) e il
point-in-time recovery sulla tabella, che permette di tornare indietro dopo un danno.

## Modello dati

Una tabella sola, chiave composta:

| Entità | `pk` | `sk` |
|--------|------|------|
| Turno | `TURNI#2026` | `2026-01-15` |
| Parametri paga | `CONFIG` | `PAGA` |

Le ore non si memorizzano: si derivano dal codice turno. Un giorno senza turno non esiste come
item — l'assenza è l'assenza, non una riga vuota.

## Il generatore Python

`genera_presenze.py` nella radice del repository resta per produrre l'xlsx. Non è più la fonte
di verità e non è collegato alla app.
