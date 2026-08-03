# API e lettura foto dietro CloudFront

Data: 2026-08-02
Stato: approvato

> **Superata in parte.** Due cose scritte qui non descrivono più il progetto, e le correzioni
> stanno accanto ai punti in cui compaiono:
>
> 1. **La Function URL della foto non è passata a `AWS_IAM` dietro Origin Access Control.** Ci
>    si è provato e l'OAC è stato tolto di nuovo; è rimasta su `authType: NONE`, cioè
>    raggiungibile da chiunque ne conosca l'indirizzo. La fonte è `infra/lib/app-stack.ts`, che
>    spiega anche perché. Vedi §*Le origini si chiudono*.
> 2. **L'autenticazione non è più fuori perimetro**, da
>    `2026-08-02-autenticazione-passkey-design.md`: le cinque rotte stanno dietro un authorizer
>    JWT e la Lambda della foto verifica il token da sé. Vedi §*Fuori perimetro*.
>
> Il resto — la porta unica, il segreto d'origine, i path relativi, il controllo del
> `content-type` — vale ancora com'è scritto.

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
├── /api/*      → API Gateway     cache off · tutti i metodi · Host non inoltrato
├── /foto/*     → Function URL    cache off · POST · Host non inoltrato · read timeout 60s
│   └── il frontend chiama /foto/leggi, non /foto
└── /*          → bucket S3       come oggi
```

Il sotto-path della lettura non è un vezzo. In un pattern di CloudFront `*` vale zero o più
caratteri **dopo** il prefisso letterale, quindi `/foto/*` richiede la barra: `/foto/leggi` la
incontra, `/foto` secco no e finisce sulla behaviour di default — il bucket, che risponde solo
a GET e HEAD — rifiutato al bordo. La Lambda dietro il path non lo guarda, quindi il segmento
non costa niente e risparmia alla distribuzione una terza behaviour. Su `/api/*` il problema
non si pone: ogni chiamata del frontend ha già un suo sotto-path.

**Le rotte di API Gateway si spostano sotto `/api`**: `/api/shifts`, `/api/shifts/{date}`,
`/api/config`. CloudFront inoltra il path così com'è, quindi non serve riscriverlo: niente
CloudFront Function, niente codice che gira al bordo a ogni richiesta, niente pezzo in più da
capire fra sei mesi. L'API ha un solo consumatore, questo frontend, quindi spostarle non
rompe nessun altro.

`{date}` non cambia nome, quindi lo spostamento delle rotte da solo non tocca gli handler. Gli
handler cambiano per un altro motivo, che allora non era nel perimetro: il controllo
sull'origine, che sta in §Le origini si chiudono.

## `Host` non si inoltra

Su entrambe le behaviour: `OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER`.

Non è un dettaglio di configurazione. Sia API Gateway sia una Lambda Function URL instradano
sull'header `Host`, e riceverlo valorizzato a `vanessa.matteo.cool` — un dominio che non
conoscono — le fa rispondere con un errore. È l'errore classico di questa configurazione, e si
manifesta come un 403 dall'origine che sembra un problema di permessi.

Il resto degli header del viewer passa, ed è necessario che passi: serve `content-type`, e
serve `x-amz-content-sha256`, senza il quale la lettura foto non supera la firma all'origine
(§Le origini si chiudono).

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

Resta su API Gateway. **Sparisce dalla Function URL.**

Dalla stessa origine non serve più — il browser non fa preflight verso sé stesso — e su API
Gateway toglierlo non guadagnerebbe niente: costa due righe che già esistono e tiene aperta la
porta a chiamare l'origine da uno script o da un test.

Sulla Function URL invece non è una scelta di comodo. Quell'origine passa a `AWS_IAM` con
Origin Access Control (vedi §Le origini si chiudono), e da lì nessun browser la raggiunge più
direttamente: un blocco CORS rimasto lì descriverebbe un accesso che non esiste più, e
leggendolo fra sei mesi si crederebbe che la Function URL si possa ancora chiamare a mano.

> **La premessa è caduta, la conclusione no.** L'OAC è stato tolto e la Function URL è rimasta
> su `NONE`, quindi l'indirizzo *è* raggiungibile a mano. Togliere il CORS resta comunque
> giusto, per un motivo diverso da quello scritto sopra: senza intestazioni CORS nessuna pagina
> di terzi può chiamare quell'indirizzo dal browser di chi la visita. Chi lo chiama fuori dal
> browser lo raggiunge eccome, e a fermarlo c'è solo il token.

## Le origini si chiudono

Non era nel perimetro della prima stesura, e ci è entrato: una volta che CloudFront è l'unica
porta, lasciare le due origini raggiungibili in proprio rende la porta un suggerimento.

> **Non è andata così.** La Function URL è rimasta su `authType: NONE`, senza Origin Access
> Control: l'OAC è stato provato e tolto — la richiesta veniva rifiutata prima che la funzione
> girasse, quindi niente arrivava al nostro codice e niente diceva perché. Il paragrafo qui
> sotto, e il prezzo dell'`x-amz-content-sha256` che lo segue, descrivono quindi una chiusura
> che **non esiste**: quell'indirizzo è raggiungibile da chiunque lo conosca, e la sua unica
> porta è il token che la Lambda verifica per prima (`api/src/token.ts`). La fonte è
> `infra/lib/app-stack.ts`.

**La Function URL** passa da `NONE` a `AWS_IAM` e sta dietro Origin Access Control: CloudFront
firma ogni richiesta con SigV4, e il permesso di invocazione è ristretto — via `SourceArn` — a
questa distribuzione. È una chiusura crittografica: senza la firma non si entra.

Ha un prezzo che va scritto, perché non è ovvio e rompe se lo si dimentica: **con OAC, un `PUT`
o un `POST` deve portare `x-amz-content-sha256` con lo SHA-256 del corpo**. Lambda non accetta
payload non firmati, e CloudFront firma con l'hash che gli ha dato il viewer — non lo calcola
lui. La lettura foto è un POST con un corpo, quindi l'hash lo calcola il browser, in `api.ts`,
sulla stessa identica stringa che spedisce. L'header arriva all'origine perché la behaviour usa
`ALL_VIEWER_EXCEPT_HOST_HEADER`, che inoltra tutto tranne `Host`.

**L'API** non può fare altrettanto: un HTTP API non ha resource policy, è una funzionalità dei
REST API. Al suo posto CloudFront le inietta un header con un segreto condiviso, che l'API
confronta a tempo costante e senza il quale rifiuta. È un segreto al portatore, non un controllo
crittografico: chi lo ottiene lo può rigiocare. Ferma gli scanner e l'accesso diretto casuale,
che è quello per cui c'è. Le due protezioni non hanno la stessa forza, e il README lo dice.

## Due cose accettate, scritte perché restino agli atti

**Il 403 e il 404 dell'API tornano come `index.html` con 200.**

Le `errorResponses` di CloudFront sono per distribuzione, non per behaviour: quelle che oggi
mappano 403 e 404 su `index.html` — perché il router del client serve i propri path, e un 403
da S3 con Origin Access Control è un file che non c'è — si applicano anche a `/api/*`.

Non è aggirabile lato CloudFront, e non ci si può appoggiare al fatto che l'app non emetta mai
quegli stati: adesso ha motivo di emetterli. Il rifiuto dell'origine sarebbe stato un 403 su una
strada che si percorre davvero, e un 403 da CloudFront può arrivare anche dall'origine foto se
una firma non torna. Da qui due mosse:

- il rifiuto dell'origine risponde **401** e non 403. CloudFront il 401 non lo riscrive, quindi
  la collisione non si presenta; ed è anche lo stato più giusto dei due, perché alla richiesta
  mancava una credenziale, non le è stata negata una risorsa per cui era identificata;
- `api.ts` **guarda il `content-type` prima di interpretare una risposta come JSON**, e se non è
  JSON solleva la frase italiana con la via d'uscita. Quello è l'unico punto che può distinguere
  l'HTML dell'app da una risposta vera, e copre ogni 403 o 404 futuro da qualunque origine —
  compresi quelli che non sappiamo ancora di poter ricevere.

Resta vero che a schermo non si vedrà un 404 pulito. Ma non si vedrà nemmeno `unexpected token
'<'`: si vedrà una frase in italiano che dice di scrivere i codici a mano.

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
| `infra/lib/app-stack.ts` | due `additionalBehaviors`, le origini, le rotte sotto `/api`, il segreto condiviso, la Function URL su `AWS_IAM` dietro OAC *(non fatto: è rimasta su `NONE`, vedi l'avviso in cima)*, l'output `PhotoUrl` che diventa informativo |
| `infra/test/stacks.test.ts` | le behaviour esistono e sono configurate come sopra; le rotte sono sotto `/api`; le due origini sono chiuse |
| `api/src/http.ts` | il confronto a tempo costante del segreto, e il 401 di chi non passa da CloudFront |
| `web/src/api.ts` | path relativi, via il guard sull'URL vuoto, `/foto/leggi`, lo SHA-256 del corpo, il controllo del `content-type` |
| `web/vite.config.ts` | proxy di `/api` e `/foto` per il server di sviluppo |
| `web/.env.production` | eliminato |
| `web/test/api.test.ts` | le chiamate vanno ai path relativi, e portano l'hash del corpo |
| `app/README.md` | via il passo «incolla l'indirizzo»; e cosa protegge davvero l'app, adesso |

Il core non si tocca. Gli handler prendono una riga ciascuno — il controllo sull'origine, primo
di tutto — e i loro test guadagnano il blocco che lo copre: era fuori dal perimetro della prima
stesura, non è un segno che qualcosa sia andato storto.

## Ordine del deploy

Frontend e rotte cambiano insieme, in un solo stack. Fra l'aggiornamento di API Gateway e
l'invalidazione di CloudFront c'è una finestra di qualche secondo in cui il frontend vecchio
chiama rotte nuove o viceversa, e le chiamate falliscono. Su un'app con un'utente sola,
accettabile. Se CloudFormation fallisce a metà, fa rollback e resta buono quello di prima.

## Fuori perimetro

Niente WAF e niente rate limiting oltre il throttling che API Gateway già fa.

La restrizione delle origini invece **è rientrata nel perimetro** durante l'esecuzione, e sta in
§Le origini si chiudono — con l'avvertenza in cima a quella sezione: solo l'API ha finito per
avere una chiusura, la Function URL no.

> **Superato dal 2026-08-02**, da `2026-08-02-autenticazione-passkey-design.md`. Il paragrafo
> qui sotto resta perché era una decisione vera, presa con cognizione del rischio, e la sua
> motivazione è parte della storia del progetto — ma non descrive più il progetto: le cinque
> rotte dell'API stanno dietro un authorizer JWT di API Gateway e la Lambda della foto verifica
> lo stesso token da sé, per prima. Il segreto d'origine resta accanto all'autenticazione, non
> al posto suo: risponde a *da quale porta sei entrato*, non a *chi sei*.

Quello che resta fuori è l'autenticazione dell'utente: dietro CloudFront l'API è aperta a
chiunque, come prima, e questa è la scelta deliberata di sempre — non una svista che le due
chiusure correggono a metà.
