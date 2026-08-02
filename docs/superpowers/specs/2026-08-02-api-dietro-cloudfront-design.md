# API e lettura foto dietro CloudFront

Data: 2026-08-02
Stato: approvato

## Obiettivo

Il browser parla con un solo indirizzo. Oggi ne conosce tre — il sito su
`vanessa.matteo.cool`, l'API su `sp99qts2me.execute-api.eu-south-1.amazonaws.com`, la lettura
delle foto su una Function URL — e due dei tre devono essere scritti a mano in
`web/.env.production` dopo ogni ricreazione dello stack.

Dopo questa modifica ce n'è uno: `https://vanessa.matteo.cool`, con `/api/` e `/foto/` che
CloudFront inoltra alle origini giuste.

## Forma

```
vanessa.matteo.cool  (CloudFront)
├── /api/*   → API Gateway     cache off · tutti i metodi · Host non inoltrato
├── /foto/*  → Function URL    cache off · POST · Host non inoltrato · read timeout 60s
└── /*       → bucket S3       come oggi
```

**Le rotte di API Gateway si spostano sotto `/api`**: `/api/shifts`, `/api/shifts/{date}`,
`/api/config`. CloudFront inoltra il path così com'è, quindi non serve riscriverlo: niente
CloudFront Function, niente codice che gira al bordo a ogni richiesta, niente pezzo in più da
capire fra sei mesi. L'API ha un solo consumatore, questo frontend, quindi spostarle non
rompe nessun altro.

`{date}` non cambia nome, quindi gli handler non si toccano. Se i loro test cambiano,
qualcosa è andato storto.

## `Host` non si inoltra

Su entrambe le behaviour: `OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER`.

Non è un dettaglio di configurazione. Sia API Gateway sia una Lambda Function URL instradano
sull'header `Host`, e riceverlo valorizzato a `vanessa.matteo.cool` — un dominio che non
conoscono — le fa rispondere con un errore. È l'errore classico di questa configurazione, e si
manifesta come un 403 dall'origine che sembra un problema di permessi.

Il resto degli header del viewer passa: serve `content-type`, e servono i CORS preflight se
mai qualcuno chiamasse le origini direttamente.

## Cosa sparisce

`VITE_API_URL` e `VITE_PHOTO_URL` non hanno più niente da dire: il frontend chiama `/api` e
`/foto` sulla propria origine. Con loro spariscono:

- il file `web/.env.production`;
- il passo del deploy che chiedeva di leggere un output dello stack e incollarlo lì — quello
  che ha lasciato la funzionalità muta dopo il primo deploy;
- il guard sull'URL vuoto in `api.ts`, che a quel punto non ha più niente da controllare.

Per `npm run dev` il server di sviluppo prende un proxy in `vite.config.ts` che inoltra `/api`
e `/foto` agli indirizzi veri. Lo sviluppo continua a funzionare senza variabili d'ambiente, e
gli indirizzi stanno in un solo posto invece che in un file di configurazione per ambiente.

## CORS

Resta dov'è, su API Gateway e sulla Function URL.

Dalla stessa origine non serve più — il browser non fa preflight verso sé stesso — ma toglierlo
non guadagna niente e chiude la porta a chiamare le origini direttamente da uno script o da un
test. Costa due righe di configurazione che già esistono.

## Due cose accettate, scritte perché restino agli atti

**Il 403 e il 404 dell'API tornano come `index.html` con 200.**

Le `errorResponses` di CloudFront sono per distribuzione, non per behaviour: quelle che oggi
mappano 403 e 404 su `index.html` — perché il router del client serve i propri path, e un 403
da S3 con Origin Access Control è un file che non c'è — si applicheranno anche a `/api/*`.

Non è aggirabile lato CloudFront. È accettabile perché **l'app non emette mai 403 né 404**:
usa 400, 413, 422, 429, 500 e 502. Un 404 arriva solo da API Gateway per una rotta che non
esiste, cioè per un bug nostro o per uno scanner. Quando succederà, l'errore a schermo sarà
`unexpected token '<'` invece di un 404 pulito: fastidioso da diagnosticare, ma su una strada
che in esercizio non si percorre.

**Il tetto dei 60 secondi sulla lettura.**

CloudFront tronca la risposta dell'origine a 30 secondi di default e a 60 al massimo, senza
chiedere una quota ad AWS. La Function URL fu scelta proprio per sfuggire ai 30 secondi di API
Gateway, quindi metterla dietro CloudFront rimette un tetto: più alto, ma un tetto.

Una lettura dovrebbe prendere fra i 15 e i 40 secondi. Dovrebbe: non ne abbiamo mai misurata
una vera, e questo numero è la scommessa di questa modifica. Oltre i 60 secondi CloudFront
risponde 504, che il frontend mostra già come «Il servizio non risponde. Riprova fra un
minuto.», e la via d'uscita — scrivere i codici a mano — è a un tocco.

Se le letture vere risultassero più lente, le uscite sono due: chiedere ad AWS la quota a 180
secondi, o riportare `/foto` sulla sua Function URL.

## Cosa cambia, per file

| File | Cosa |
|------|------|
| `infra/lib/app-stack.ts` | due `additionalBehaviors`, le origini, le rotte sotto `/api`, l'output `PhotoUrl` che diventa informativo |
| `infra/test/stacks.test.ts` | le behaviour esistono e sono configurate come sopra; le rotte sono sotto `/api` |
| `web/src/api.ts` | path relativi, via il guard sull'URL vuoto |
| `web/vite.config.ts` | proxy di `/api` e `/foto` per il server di sviluppo |
| `web/.env.production` | eliminato |
| `web/test/api.test.ts` | le chiamate vanno ai path relativi |
| `app/README.md` | via il passo «incolla l'indirizzo», e le tre righe che lo spiegavano |

Gli handler, il core e i test dell'API non si toccano.

## Ordine del deploy

Frontend e rotte cambiano insieme, in un solo stack. Fra l'aggiornamento di API Gateway e
l'invalidazione di CloudFront c'è una finestra di qualche secondo in cui il frontend vecchio
chiama rotte nuove o viceversa, e le chiamate falliscono. Su un'app con un'utente sola,
accettabile. Se CloudFormation fallisce a metà, fa rollback e resta buono quello di prima.

## Fuori perimetro

Niente WAF, niente rate limiting, niente restrizione delle origini perché siano raggiungibili
solo da CloudFront. Restano pubbliche entrambe, come oggi. Questa modifica rende possibile
metterci mano in un posto solo, un domani; non ce la mette.
