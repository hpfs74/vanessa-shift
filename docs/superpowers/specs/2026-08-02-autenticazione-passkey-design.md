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
```

Le due metà si difendono in modo diverso per una ragione tecnica, non per gusto: **un
authorizer Cognito non si può attaccare a una Function URL**. API Gateway lo ha nativo; la
Lambda della foto verifica il token da sé contro le chiavi pubbliche del pool.

Il segreto d'origine introdotto in `2026-08-02-api-dietro-cloudfront-design.md` **resta**.
Risponde a una domanda diversa — da quale porta sei entrato, non chi sei — e le due cose non si
sostituiscono a vicenda.

## Cognito

- **User pool**, accesso via email, `featurePlan: ESSENTIALS`. Le passkey non esistono nel piano
  Lite: questo è il motivo del piano, non una preferenza.
- **Primi fattori ammessi**: passkey, codice una-tantum via email, password.
- `passkeyRelyingPartyId: vanessa.matteo.cool` — deve essere il dominio da cui si fa login.
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

### Il primo accesso non può essere una passkey

Non si registra un volto su un account che non esiste. Il primo ingresso è un codice una-tantum
via email; da lì si registra la passkey su quel telefono. Serve quindi un indirizzo email che
Vanessa legga dal telefono, una volta sola.

Ogni dispositivo nuovo ripete il giro: codice via email, poi passkey su quel dispositivo.

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

Nessuno di questi le perde quello che stava scrivendo: le chiamate che modificano dati sono
tutte singole e ripetibili.

## Costo

Il piano Essentials di Cognito si paga a utente attivo mensile, con una fascia gratuita. Con
una o due persone la spesa è nulla o trascurabile.

**Da verificare in console prima del deploy**, non asserito qui: la fascia gratuita esatta del
piano Essentials. Oggi ho sbagliato tre volte una disponibilità AWS dandola per verificata
leggendo la fonte sbagliata, e non ho intenzione di scriverne una quarta senza guardare.

## Fuori perimetro

Niente registrazione aperta: gli utenti si creano a mano, sono uno o due. Niente recupero
password self-service. Niente ruoli o permessi. Niente logout su tutti i dispositivi. Niente
multiutente sui dati, come detto sopra.
