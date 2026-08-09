# Profilo

Data: 2026-08-09
Stato: approvato

## Obiettivo

Una schermata dove Vanessa ritrova i suoi dati: chi è per l'app, cosa dice il suo contratto,
con quali parametri viene simulato lo stipendio, e con quale account è entrata.

Oggi questi dati non stanno da nessuna parte. I sei parametri di paga esistono, ma vivono
dentro **Stipendio** come campi di un calcolo, non come dati suoi. Nome, livello, sede, data di
assunzione non esistono affatto — né nella tabella, né in Cognito, né nel foglio da cui l'app
è nata.

La schermata si consulta più che modificarsi. È il posto dove si va a controllare il livello
CCNL prima di scrivere la tariffa oraria, non una pagina che si apre tutti i giorni.

## Cosa questo NON fa

**Non rende l'app multiutente.** Vale ancora quanto scritto in
`2026-08-02-autenticazione-passkey-design.md`: la chiave è `pk = CONFIG`, senza utente dentro.
Il profilo è di chiunque entri, come lo sono i turni. Chi entra è una persona sola, e questa
schermata non cambia quel presupposto — lo rende solo più visibile, perché adesso c'è un nome
scritto.

**Non tocca nessun calcolo.** Nessun campo del profilo entra nelle ore, nel riepilogo o nella
simulazione dello stipendio. In particolare le ore settimanali da contratto — vedi sotto, perché
è la cosa che più facilmente verrà data per scontata.

**Non aggiunge una rotta né una Lambda.** Il perché sta in **L'API**.

## Dove sta

Un pulsante nell'`<header>` che già esiste, accanto a «Turni di Vanessa», in alto a destra.
Apre il profilo a schermo intero, con un ritorno indietro.

**La barra in basso resta a cinque voci.** Era l'alternativa ovvia — una sesta linguetta accanto
a Stipendio — ed è stata scartata per due ragioni. La prima è di spazio: su 375px le cinque
voci hanno 75px a testa, sei ne avrebbero 62, e le etichette («Riepilogo», «Calendario») vanno
già strette così. Il bersaglio da 44px reggerebbe, l'etichetta no. La seconda è di frequenza: la
barra in basso è dove arriva il pollice, e quello spazio appartiene alle viste di tutti i
giorni. Il profilo si apre due volte l'anno.

## I dati

### Il record

Un tipo nuovo in `core/src/profile.ts`, esportato da `core/src/index.ts`. Sta in `core` per la
stessa ragione per cui ci sta `PaySettings`: è l'unico posto che `api` e `web` raggiungono
tutti e due.

```ts
export interface Profile {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly employer: string | null;       // cooperativa
  readonly hiredOn: IsoDate | null;       // data di assunzione
  readonly contractKind: 'indeterminato' | 'determinato' | null;
  readonly ccnlLevel: string | null;      // C1, D2...
  readonly jobTitle: string | null;       // qualifica
  readonly weeklyHours: number | null;    // solo mostrato: vedi sotto
  readonly workplace: string | null;      // sede
  readonly ward: string | null;           // reparto
}
```

`EMPTY_PROFILE` ha ogni campo a `null`.

**Ogni campo è nullable, e non è pigrizia.** Un profilo che pretende di essere completo prima
di lasciarsi salvare è un profilo che non viene salvato mai: si comincia a compilarlo, manca il
livello CCNL che sta su un contratto in un cassetto, e si perde anche quello che si era già
scritto. Metà profilo salvato vale più di nessun profilo.

Un item solo su DynamoDB, a `pk = 'CONFIG'`, `sk = 'PROFILE'`, accanto a `sk = 'PAY'` che c'è
già. I campi assenti si omettono dall'item invece di scriverli a `null`, come fa già `itemOf`
per i turni: un attributo che non c'è si legge senza ambiguità come «non impostato».

### Le ore settimanali si vedono, non si contano

`weeklyHours` è **solo mostrato**. Niente lo legge: non il calcolo delle ore, non il riepilogo,
non la simulazione dello stipendio.

Va detto qui e ripetuto in un commento sul campo, perché è precisamente il genere di cosa che
fra sei mesi si dà per fatta. Un numero che dice «24 ore settimanali» seduto accanto alle ore
davvero lavorate *sembra* un confronto già implementato, e non lo è.

Collegarlo è un lavoro vero, non una riga: pretende di decidere cosa fare dei mesi cominciati a
metà, dei festivi, delle assenze e delle ferie — e di queste ultime il modello dati oggi non sa
niente. È una spec sua, se e quando servirà.

## L'API

### Perché `/config` e non `/profilo`

Una rotta `/profilo` con GET e PUT sarebbe più pulita da leggere. Costa però **due Lambda
nuove**, perché in `app-stack.ts` ogni rotta ha la sua funzione, più una modifica allo stack,
più un deploy, più l'aggiornamento del controllo di fine pipeline che oggi verifica il 401 su
esattamente cinque rotte.

Per una schermata sola, in una app da un utente, è molto ferro per un segmento di URL più bello.

Quindi il profilo passa da `/api/config`, che esiste già:

- `GET /api/config` restituisce `{ pay, profile, quota }` invece di `{ pay }`
- `PUT /api/config` accetta `{ pay?, profile? }` e scrive solo le chiavi presenti

Nessuna rotta nuova, nessuna Lambda nuova, nessuna modifica all'infrastruttura, e il controllo
sulle cinque rotte in `deploy.yml` resta com'è.

Il nome `sk = 'PAY'` sembrava fatto apposta: se la configurazione fosse stata una sola, la
chiave di ordinamento non avrebbe avuto bisogno di un discriminante.

### Due item, non uno

`profile` e `pay` finiscono su **due item distinti**, non su due rami dello stesso.

È questo che rende sicura una rotta condivisa. Con un item solo, un salvataggio del profilo
dovrebbe rileggere i parametri di paga e riscriverli insieme — e `savePaySettings` fa un `Put`
intero, non un aggiornamento parziale, quindi basta un campo dimenticato nel giro per azzerare
la tariffa oraria salvando il cognome. Su due item la cosa non è improbabile: è impossibile,
perché le due scritture toccano righe diverse.

### La quota

`GET /api/config` porta anche `quota: { used }` — quante letture della foto sono state
consumate oggi. Un `GetCommand` sulla riga che `consumePhotoQuota` già scrive, e `0` quando la
riga non c'è, che è il caso normale a inizio giornata.

**Il massimo non viaggia sulla rete.** `MAX_READINGS_PER_DAY` sta in `core/src/photo.ts`, e
`web` importa `core`: il denominatore del «3 di 10» lo prende da lì. Mandarlo nella risposta
vorrebbe dire avere lo stesso numero in due posti, e prima o poi in due valori.

### Il corpo vecchio continua a funzionare

Oggi `PUT /api/config` riceve un `PaySettings` nudo, non `{ pay: ... }`. Il corpo nuovo cambia
forma, e per un momento le due convivono: la SPA sta in cache sul telefono, e dopo un deploy
può benissimo mandare ancora la forma vecchia.

Regola: se il corpo **non** ha né la chiave `pay` né la chiave `profile`, si legge come un
`PaySettings` nudo, esattamente come oggi. Costa tre righe e toglie di mezzo un giorno in cui
salvare lo stipendio da un telefono non aggiornato dà errore.

## Il frontend

### L'email si legge dal token, e non vale come permesso

Il blocco «Account» mostra l'email con cui si è entrate. Viene dal token di sessione, decodificato
**nel browser**: `web/src/claims.ts`, nuovo e piccolo, fa il base64url del payload del JWT e ne
legge `email`. Lo scope è già `openid email`, quindi il dato c'è.

**Non verifica la firma, e non deve diventare un controllo.** Un JWT decodificato nel client è
testo che il client stesso potrebbe riscrivere: serve a scrivere un indirizzo sullo schermo, non
a decidere cosa qualcuno può fare. La verifica vera esiste ed è altrove — `api/src/token.ts`, che
controlla la firma contro le chiavi pubbliche del pool, per ogni chiamata.

L'avvertenza va **nel file**, non solo qui. Un modulo che si chiama `claims.ts` ed espone
`email` è un invito a farci un `if`, e chi lo aprirà fra un anno non avrà letto questa spec.

### La schermata

`web/src/Profilo.tsx`, cinque blocchi:

| Blocco | Contenuto | Modificabile |
|--------|-----------|--------------|
| Account | email, quando scade la sessione | no |
| Dati personali | nome, cognome, datore di lavoro, data di assunzione | sì |
| Contratto | tipo, livello CCNL, qualifica, ore settimanali, sede, reparto | sì |
| Retribuzione | i sei parametri di paga, con un rimando a Stipendio | no |
| App | versione, `n di 10 letture foto oggi` | no |

«Retribuzione» è in sola lettura di proposito: i parametri si modificano in **Stipendio**, dove
stanno accanto alla simulazione che li usa. Averli in due posti modificabili vuol dire due
schermate che possono dire cose diverse. Qui servono a rispondere a una domanda sola — «con che
tariffa sta calcolando?» — accanto al livello CCNL che quella tariffa la giustifica. È l'unica
ragione per cui i due blocchi si toccano.

Il salvataggio segue la forma già in uso in `Pay.tsx`: niente di nuovo da inventare per i campi.

### La versione

Un `define` in `vite.config.ts` con lo SHA del commit, preso da `GITHUB_SHA` in pipeline e con
`dev` come ripiego in locale. Serve a una cosa sola: quando lei dice «non funziona», sapere
quale build ha in mano.

## Cosa vede Vanessa quando qualcosa non va

| Caso | Cosa succede |
|------|--------------|
| Profilo mai compilato | Campi vuoti, non un errore. È lo stato iniziale, non un guasto. |
| Il caricamento fallisce | Il messaggio dell'errore, e il resto della schermata resta usabile. |
| Il salvataggio fallisce | Il messaggio, e quello che ha scritto resta nei campi. Si ritenta con lo stesso pulsante. |
| Token illeggibile o senza email | Il blocco Account resta vuoto. Non solleva, e non porta giù la schermata con sé. |
| Sessione scaduta mentre è aperta | Come ovunque nell'app: 401, rinnovo silenzioso, si riprova. Vedi la spec dell'autenticazione. |

Il salvataggio del profilo è **una scrittura sola e ripetibile**, come tutte le altre scritture
dell'app: ritentare non raddoppia niente. Ma l'idempotenza non basta a evitare una perdita qui.
Ogni altra schermata scrive a ogni interazione, quindi non c'è mai niente di non salvato quando
arriva un 401; il Profilo è invece la prima schermata dell'app a raggruppare più campi in un
salvataggio unico. `sessioneRifiutata()` ricarica la pagina su un 401, e il ricaricamento
cancella quello che c'era nei campi prima che l'idempotenza abbia modo di aiutare. È un rischio
accettato, non risolto: basso, dato il margine di rinnovo e una sessione che dura l'intera
giornata, ed è la ragione per cui il Profilo si apre due volte l'anno e non resta aperto a lungo.

## Cosa cambia nel codice

| Dove | Cosa |
|------|------|
| `core/src/profile.ts` (nuovo) | il tipo `Profile`, `EMPTY_PROFILE` |
| `core/src/index.ts` | esporta `./profile.js` |
| `api/src/repo.ts` | `readProfile`, `saveProfile`, `readPhotoQuota` |
| `api/src/http.ts` | `requireProfile`, che riusa `optionalText` e `requireDate` |
| `api/src/handlers.ts` | `getConfig` restituisce tre cose; `putConfig` scrive quello che riceve |
| `web/src/claims.ts` (nuovo) | decodifica del payload del token, con l'avvertenza |
| `web/src/Profilo.tsx` (nuovo) | la schermata |
| `web/src/App.tsx` | il pulsante nell'header, e la schermata che si apre |
| `web/src/api.ts` | `profile()`, `saveProfile()` |
| `web/vite.config.ts` | il `define` con lo SHA |

`app-stack.ts` non si tocca, e nemmeno `deploy.yml`.

`requireProfile` non scrive validatori nuovi per le stringhe: `optionalText(v, field, max)` esiste
già in `http.ts` e fa esattamente quello che serve — taglia, rifiuta ciò che non è testo, e
restituisce `null` per il vuoto. Vale per sette campi su dieci, e `hiredOn` usa `requireDate`.

Due campi però non sono testo libero e `optionalText` da solo li lascerebbe passare sbagliati:

- **`contractKind`** è una unione di due valori. Va confrontato con `'indeterminato'` e
  `'determinato'`, e rifiutato se è altro. Senza il confronto il tipo in `core` dichiara due
  valori e il database ne contiene un terzo, che è il modo in cui un tipo smette di dire il vero.
- **`weeklyHours`** è un numero. Serve un controllo suo: numero finito, non negativo, e non oltre
  168 — le ore che una settimana contiene. Lo zero è ammesso e non va confuso con l'assente,
  come già succede per `hoursOverride` sui turni.

## Test

| Pacchetto | Cosa si prova |
|-----------|---------------|
| `core` | la forma di `Profile` e `EMPTY_PROFILE` |
| `api` | andata e ritorno del profilo sul repo; la quota letta quando la riga non c'è; il `GET` che porta tre cose; il `PUT` parziale — **e che scrivere il profilo lascia i parametri di paga intatti**; il corpo vecchio che continua a funzionare; `requireProfile` che rifiuta un `contractKind` inventato e un `weeklyHours` negativo, oltre 168, o non numerico |
| `web` | `claims.ts` su un token valido, uno malformato e uno senza email; `Profilo.tsx` che disegna, si modifica e salva; il pulsante nell'header che la apre |

Le due righe che contano davvero sono in `api`: **il `PUT` parziale che non tocca l'altro item**,
perché è l'unica cosa che rende difendibile la scelta di una rotta condivisa, e **il corpo
vecchio**, perché è un guasto che si vedrebbe solo da un telefono con la cache vecchia — cioè
mai, in sviluppo.

## Fuori perimetro

Niente foto o avatar. Niente cambio email — l'indirizzo è il nome utente su Cognito, e cambiarlo
è un'operazione sul pool, non un campo. Niente gestione delle passkey registrate (elencarle o
revocarle vuol dire chiamare l'API di Cognito da una Lambda che oggi non esiste). Niente logout,
che resta fuori come nella spec dell'autenticazione. Niente storico delle modifiche al profilo.
Niente «spazio occupato»: è un numero che costa una scansione della tabella e su cui non c'è
nessuna azione da prendere.
