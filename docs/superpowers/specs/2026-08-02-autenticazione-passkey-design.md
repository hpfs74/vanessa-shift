# Autenticazione con passkey

Data: 2026-08-02
Stato: approvato

## Obiettivo

Chiudere l'app a chi non è Vanessa.

Oggi chiunque conosca `https://vanessa.matteo.cool` legge e modifica i suoi turni e i suoi
parametri di paga. Era una scelta esplicita, documentata in `2026-08-02-web-app-aws-design.md`,
e smette di esserlo qui.

Si entra col volto: passkey su Cognito, verifica biometrica obbligatoria. La password esiste
comunque — Cognito non permette di toglierla — ma non è la strada normale.

## Cosa questo NON fa

**Non rende l'app multiutente.** La tabella resta com'è: `pk = SHIFTS#2026`, senza utente
nella chiave. Chi entra vede i turni di Vanessa, chiunque sia.

È deliberato. Il problema di oggi è che entra chiunque, e si risolve con l'autenticazione da
sola. Mettere l'utente dentro le chiavi vuol dire toccare il modello dati, tutti e sei gli
handler e migrare i dati esistenti — lavoro che ha senso fare quando il secondo calendario
serve davvero, e che allora sarà la migrazione più facile possibile perché i dati dentro sono
di una persona sola.

Quello che questa scelta compra per dopo: il token porta già l'identità (`sub`), quindi la
chiave utente ha già da dove venire.

## Forma

```
vanessa.matteo.cool  (CloudFront)
├── /*            → la SPA. Senza sessione valida va a Cognito e torna
├── /api/*        → API Gateway + authorizer JWT Cognito
└── /foto/leggi   → Function URL: il JWT lo verifica la Lambda, in codice

auth.vanessa.matteo.cool  (dominio personalizzato del pool)
└── Managed Login. È il «va a Cognito» qui sopra, ed è anche il relying
    party id della passkey — vedi sotto.
```

Le due metà si difendono in modo diverso per una ragione tecnica, non per gusto: **un
authorizer Cognito non si può attaccare a una Function URL**. API Gateway lo ha nativo; la
Lambda della foto verifica il token da sé contro le chiavi pubbliche del pool.

Il segreto d'origine introdotto in `2026-08-02-api-dietro-cloudfront-design.md` **resta**.
Risponde a una domanda diversa — da quale porta sei entrato, non chi sei — e le due cose non si
sostituiscono a vicenda.

Vale però **solo per l'API**, ed è bene dirlo qui perché la frase sopra parla di «due metà». La
Function URL della foto non ha nessuna chiusura d'origine: è su `authType: NONE`, senza Origin
Access Control — quella spec lo prevedeva, l'implementazione lo ha provato e tolto — quindi la
raggiunge chiunque ne conosca l'indirizzo. **Il token che la Lambda verifica è l'unica porta di
quella metà.** Vedi `infra/lib/app-stack.ts` e l'avviso in cima all'altra spec.

## Cognito

- **User pool**, accesso via email, `featurePlan: ESSENTIALS`. Le passkey non esistono nel piano
  Lite: questo è il motivo del piano, non una preferenza.
- **Primi fattori ammessi**: passkey, codice una-tantum via email, password.
- `passkeyRelyingPartyId: auth.vanessa.matteo.cool` — **deve essere esattamente il dominio da cui
  si fa login**, non il dominio della app. Il browser accetterebbe anche `vanessa.matteo.cool`,
  visto che l'host di login gli sta sotto; Cognito no, e pretende il nome completo del dominio
  personalizzato. Da qui il dominio di accesso tutto suo, sotto un nome che controlliamo.
- `passkeyUserVerification: required` — è questo che obbliga il volto o l'impronta. Senza,
  basterebbe che il telefono fosse sbloccato.
- **Managed Login** come pagina di accesso, app client pubblico, authorization code + PKCE.
  Niente client secret: un segreto dentro un bundle JavaScript non è un segreto.

### La password c'è comunque, e va detto

L'API di Cognito dichiara `password: boolean` con sopra scritto **"This must be true"**. Non è
una scelta: una password esiste sempre e funziona sempre. La passkey è la strada comoda, non
l'unica.

Conseguenza pratica: la sicurezza di questa app ha come pavimento la forza di quella password,
non la biometria. Va generata lunga e casuale, e messa in un gestore di password — non
memorizzata, perché nessuno deve doverla digitare.

E il pavimento è scritto nello stack, non lasciato al default: `passwordPolicy` con lunghezza
minima 32 e tutte e quattro le classi di caratteri. Senza, il pool eredita gli otto caratteri
di default di Cognito, che è un numero che nessuna riga di questo repository dichiara e che
chiunque può cambiare in console senza che un test se ne accorga.

### Il perimetro vero è la sua casella di posta

Il codice via email non è solo il primo accesso: resta un modo per entrare, completo, per
sempre. La passkey quindi **non fa da cancello a niente** — sta accanto ad altre due strade,
la password e il codice, ed è la più comoda delle tre, non l'anello più forte di una catena.

Chi ha accesso alla casella di Vanessa ha accesso all'app, volto o non volto.

È una conseguenza del bootstrap, non una svista: senza il codice via email non esisterebbe
modo di registrare la prima passkey, né di rientrare da un telefono nuovo o perso senza che
qualcun altro riaccenda qualcosa in console. Il costo di toglierlo è un passo manuale addosso a
un'altra persona ogni volta che lei cambia telefono, ed è stato valutato e scartato.

Va detto perché «si entra col volto» suona come una garanzia che non è: il volto è la porta di
tutti i giorni, la casella è il perimetro.

### Il primo accesso non può essere una passkey

Non si registra un volto su un account che non esiste. Il primo ingresso è un codice una-tantum
via email; da lì si registra la passkey su quel telefono. Serve quindi un indirizzo email che
Vanessa legga dal telefono, una volta sola.

Ogni dispositivo nuovo ripete il giro: codice via email, poi passkey su quel dispositivo.

**«Da lì si registra la passkey» non succede da solo, ed è costato una settimana.** La frase qui
sopra dava per scontato che dopo il codice via email Cognito proponesse di creare la passkey. Non
lo fa, e la documentazione AWS è esplicita sul perché: *«Amazon Cognito doesn't prompt users to
set up a passkey when they have already signed up and not set up a passkey, or if you created
their account as an administrator.»* L'account di Vanessa è creato con `admin-create-user` —
è la procedura che questo stesso repository prescrive — quindi ricade in quel caso per sempre.

E una passkey non si può **usare** prima di averla **registrata**. Il risultato è che il pool può
essere configurato alla perfezione — e lo era: relying party id giusto, `required`, Managed Login
v2, `ALLOW_USER_AUTH`, `WEB_AUTHN` fra i primi fattori — e si entra comunque sempre col codice via
email. Nessun test lo vede, perché non c'è niente di rotto.

La registrazione sta dietro una pagina a parte di Managed Login, `/passkeys/add`, e ci si arriva
solo se l'applicazione ci manda. Nel profilo c'è ora il link. Va aperto **da ogni telefono**:
la passkey resta su quello dove è stata creata.

## Quanto dura una sessione

**Circa un giorno.**

Il comportamento naturale di OAuth è l'opposto di quello che si vuole qui: con un refresh token
lungo l'utente rientra in silenzio e non gli viene chiesto mai più niente. È il massimo della
comodità, ed è anche il motivo per cui un telefono smarrito resta dentro per mesi.

Una sessione di un giorno significa un tocco di Face ID la mattina, quando apre l'app la prima
volta. È attrito quasi nullo per lei, ed è l'unica cosa che una durata di sessione protegge
davvero: qualcuno che ha in mano il suo telefono sbloccato.

Refresh token a 24 ore, access token e id token a un'ora. Finché la app è aperta e in uso non
succede niente di visibile.

## Cosa cambia nel codice

| Dove | Cosa |
|------|------|
| `infra/lib/auth-stack.ts` (nuovo) | user pool, dominio, app client, output di pool id e client id |
| `infra/lib/app-stack.ts` | authorizer JWT sulle cinque rotte; pool id e client id nell'ambiente della Lambda foto |
| `api/src/token.ts` (nuovo) | verifica del JWT contro le chiavi pubbliche del pool, con cache delle chiavi |
| `api/src/handlers.ts` | `readPhoto` verifica il token prima di tutto il resto — prima della quota, prima di Bedrock |
| `web/src/auth.ts` (nuovo) | PKCE, redirect, scambio del codice, conservazione e rinnovo del token |
| `web/src/api.ts` | `Authorization: Bearer` su ogni chiamata; un 401 rimanda al login |
| `web/src/App.tsx` | finché non c'è sessione non si disegna nulla e si va a Cognito |

Gli handler dell'API non cambiano: l'authorizer li protegge da fuori, e nessuno di loro guarda
chi è l'utente perché i dati restano di una persona sola.

## L'ordine dei controlli nella Lambda foto

Il token si verifica **per primo**, prima della dimensione del corpo, prima della quota, prima
di Bedrock.

La ragione è la stessa per cui la dimensione viene prima della quota: rifiutare non deve
costare. Una richiesta senza token valido non deve consumare una delle dieci letture del
giorno, altrimenti chiunque conosca l'indirizzo può esaurirle tutte senza avere accesso a
niente.

## Cosa vede Vanessa quando qualcosa non va

| Caso | Cosa succede |
|------|--------------|
| Sessione scaduta all'apertura | Va a Cognito, Face ID, torna dov'era. Nessun messaggio. |
| Sessione scaduta mentre l'app è aperta | Un 401 da una chiamata: si rinnova in silenzio e si riprova. Se anche il rinnovo scade, si va al login. |
| Passkey rifiutata o annullata | Resta sulla pagina di Cognito, che lo dice da sé. |
| Telefono nuovo | Codice via email, poi registra la passkey. |
| Cognito rifiuta l'accesso (utente disabilitato, client non autorizzato) | Il motivo torna nella query string e il cancello lo mostra, invece di rimandare alla stessa pagina che l'ha appena rifiutato. |
| Si entra, ma il servizio rifiuta le chiamate lo stesso | Un rinnovo silenzioso; se anche il giro dopo viene rifiutato, il cancello si ferma e lo dice: non è qualcosa che possa sistemare lei. Non un altro Face ID. Contano i giri, non le chiamate: due richieste rifiutate insieme sono un rifiuto solo. |
| L'accesso non si completa mai (lo scambio del codice fallisce) | Un secondo tentativo, perché una connessione che cade sulla via del ritorno si cura da sé. Se anche quello non produce una sessione il cancello si ferma: dice di ricaricare, e che se il messaggio ricompare è un problema di configurazione. Il motivo è nella console del browser, su tutti e tre i modi in cui lo scambio può fallire. |

Le ultime tre righe sono la ragione per cui questa tabella non è solo documentazione: **ognuna
delle tre è un giro infinito senza una parola sullo schermo, se la riga non c'è.** Sono state
scritte una alla volta, dopo che ognuna era stata scoperta.

Nessuno di questi le perde quello che stava scrivendo: le chiamate che modificano dati sono
tutte singole e ripetibili.

## Costo

**0,015 $ per utente attivo al mese**, piano Essentials in `eu-south-1`, letto dalla API dei
prezzi di AWS e non stimato. In due fa tre centesimi al mese, e la fascia gratuita — qualunque
sia — non cambia niente a questa scala.

## Fuori perimetro

Niente registrazione aperta: gli utenti si creano a mano, sono uno o due. Niente recupero
password self-service — `accountRecovery: NONE`: con il codice via email già fra i primi
fattori, una procedura di reset non darebbe a un attaccante con la casella niente che non abbia
già, e aggiungerebbe una superficie in più e un link sulla pagina di accesso. Niente ruoli o permessi. Niente logout su tutti i dispositivi. Niente
multiutente sui dati, come detto sopra.
