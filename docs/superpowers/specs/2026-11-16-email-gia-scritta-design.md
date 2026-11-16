# L'email già scritta, e la passkey al posto del codice

Data: 16 novembre 2026
Stato: approvato

## Perché

Ogni mattina Vanessa apre l'app, la pagina di accesso di Cognito le chiede l'email, e poi le
manda un codice per posta. Due passaggi a mano per entrare in un'app che usa da sola.

I log di CloudTrail (ultimi 90 giorni, pool `eu-south-1_Kqxg19giH`) dicono che la passkey in
questa app funziona già: gli accessi «email → passkey» riescono, in circa sei secondi, da iPhone
e da Mac. Nessun accesso con codice nei log. La spiegazione più probabile è che il telefono di
Vanessa una passkey non l'abbia mai registrata: Cognito la propone solo sul dispositivo che ne
ha una, e altrimenti ripiega sul codice.

## Obiettivi

- L'email arriva già scritta sulla pagina di Cognito: basta «Continua».
- Dopo «Continua», Face ID invece del codice per posta.

## Fuori perimetro

- **Una schermata di accesso nostra** (approccio B, sotto).
- **La PWA.** Non cambia quante volte si entra: lo decide la durata della sessione.
- **La durata della sessione.** Resta un giorno (`refreshTokenValidity` in
  `infra/lib/auth-stack.ts`): si entra una volta al giorno, ma in due tocchi invece che a mano.
- **Sapere dall'app se il telefono ha una passkey.** Servirebbe l'access token con lo scope
  `aws.cognito.signin.user.admin`, che l'app non chiede e non conserva.

## Approcci

**A. La pagina di Cognito resta, con l'email suggerita — scelto.** L'app mette l'email nel link
di accesso (`login_hint`), Vanessa registra una passkey una volta dal Profilo. Poche righe, e le
passkey già registrate continuano a funzionare. Scelto perché è piccolo e mette alla prova
l'ipotesi «manca la passkey» prima di costruire altro.

**B. Una schermata nostra.** «Entra» → Face ID, senza uscire dall'app. Ma con la pagina di
Cognito fuori dal giro la passkey va legata al dominio dell'app invece che a
`auth.vanessa.matteo.cool`: tutte le passkey esistenti smettono di funzionare, l'accesso in
`web/src/auth.ts` si riscrive, e il ripiego col codice e la registrazione della passkey vanno
costruiti in casa. Rimandato: rende un tocco su una pagina altrui, e vale la pena solo se A non
basta.

## Come

### `web/src/auth.ts`

- Una chiave nuova in `localStorage`, `CHIAVE_EMAIL = 'email'`.
- `completaAccesso()`, dopo aver salvato la sessione, legge l'email dall'ID token
  (`claimsOf(...).email`, già in `claims.ts`) e la salva. Ad ogni accesso riuscito, non solo il
  primo: se l'email cambia in Cognito, la prossima volta si corregge da sola.
- `esci()` **non** la cancella. `esci()` gira anche quando il giorno della sessione finisce, ed è
  proprio la mattina dopo che l'email serve.
- `iniziaAccesso()` aggiunge `login_hint=<email>` al link di `/oauth2/authorize` quando l'email
  c'è, e non aggiunge niente quando non c'è.

Un'email in chiaro in `localStorage` non è un segreto: è già scritta nell'ID token che sta
accanto, e sulla pagina di Cognito ci finisce comunque.

### La passkey, una volta

Non è codice: Vanessa apre Profilo sul suo telefono e tocca il link della passkey che c'è già
(`urlRegistrazionePasskey()`). Va fatto subito dopo un accesso, perché la pagina delle passkey di
Cognito accetta solo una sessione fresca. Una volta per telefono: su un telefono nuovo si rifà.

## Test

In `web/test`, accanto a quelli di `auth.ts`:

- con un'email salvata, il link di `iniziaAccesso()` contiene `login_hint` con quell'email;
- senza, il link non ha `login_hint`;
- `completaAccesso()` salva l'email letta dall'ID token;
- `esci()` lascia l'email dov'è.

## Da verificare dopo il deploy

- Che la pagina di Cognito mostri davvero l'email già scritta. `login_hint` è documentato per
  `/oauth2/authorize`, ma con managed login e l'accesso a scelta si vede solo provando.
- Che dopo la registrazione, sul telefono di Vanessa, «Continua» porti a Face ID e non al codice.
