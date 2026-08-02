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
| **Carica** | scegli il mese, scrivi la sequenza dei codici e riempi tutto in un colpo. Mostra quali giorni sovrascriverebbe **prima** di salvare. |
| **Scambi** | saldo favori e saldo ore per collega, come il foglio Scambi. |
| **Riepilogo** | turni per codice, giorni lavorati e ore per mese, con le barre. |
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

## Mobile first

L'app si usa dal telefono. Navigazione in basso dove arriva il pollice, target di tocco da
44px, i pannelli di modifica salgono dal basso, gli input a 16px perché Safari iOS non
faccia lo zoom quando prendono il fuoco, e le tabelle scorrono da sole invece di far
scorrere la pagina in orizzontale.

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
| Ruolo `vanessa-shift-deploy` | assumibile **solo** da `repo:hpfs74/vanessa-shift:ref:refs/heads/main` |

Il ruolo non e' amministratore: puo' solo assumere i ruoli che il bootstrap CDK ha creato
nelle due regioni usate, e leggere gli output dei due stack di questo progetto. Un altro
repository, o un altro branch di questo, non riesce ad assumerlo.

Se il repository viene rinominato o spostato, la condizione di trust del ruolo va aggiornata,
altrimenti il deploy smette di funzionare — di proposito.

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
