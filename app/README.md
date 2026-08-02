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

## Risorse AWS

Account `495133941005`, regione `eu-south-1`. Il certificato sta in `us-east-1` perché
CloudFront non ne accetta altrove: da qui i due stack.

| Stack | Contenuto |
|-------|-----------|
| `VanessaCertificato` | certificato ACM (us-east-1) |
| `VanessaApp` | tabella, Lambda, API, bucket, distribuzione, record DNS |

L'endpoint dell'API sta in `web/.env.production`. Se lo stack viene ricreato l'endpoint cambia
e va aggiornato lì prima di ricompilare il frontend.

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
