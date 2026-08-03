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

**`npm run build`, e quindi `npm run deploy`, si rifiutano se `web/.env.production` non ha
`VITE_LOGIN_DOMAIN` e `VITE_CLIENT_ID` compilati.** Non è un checkout rotto: è una guardia
voluta. Prima che esistesse, un client id lasciato vuoto per errore si buildava pulito, si
distribuiva pulito, e falliva solo quando lei provava ad aprire l'app — un errore anonimo sulla
pagina di Cognito, non qui. Un build rosso è il segnale giusto, non un guasto da aggirare:
**non va sistemato inventando un valore.** Su un checkout nuovo, prima che `VanessaAccesso` sia
mai stato distribuito, `VITE_CLIENT_ID` è vuoto di proposito — il pool non esiste ancora — e
l'unica cosa giusta è la sequenza sotto.

`VITE_LOGIN_DOMAIN` invece è già compilato e non va toccato: vale
**`https://auth.vanessa.matteo.cool`**, cioè la pagina di accesso sul nostro dominio, non su
`amazoncognito.com`. Il perché sta in **Autenticazione**, e non è una preferenza estetica: da
un indirizzo Amazon la passkey non funziona affatto. La guardia controlla che sia un'origine
`https://` con un host e senza percorso — non più che assomigli a un dominio Cognito, forma che
rifiutava proprio il valore giusto.

### Primo deploy — e ogni volta che `VanessaAccesso` viene ricreato

Ordine obbligato: **prima `VanessaCertificato`, poi `VanessaAccesso`, poi il client id nel
frontend, poi `VanessaApp`.** Il pool ha bisogno del certificato di `auth.vanessa.matteo.cool`,
`VanessaApp` legge gli output del pool, e il frontend deve conoscere il client id prima di poter
compilare qualcosa che sappia entrare.

1. `cd infra && npx cdk deploy VanessaCertificato` — emette i due certificati e li valida da sé
   via DNS, aggiungendo i record CNAME nella zona.
2. `npx cdk deploy VanessaAccesso` — leggi dagli output `IdPool`, `IdClient`, `DominioLogin`.
3. Incolla `IdClient` in `web/.env.production` (`VITE_CLIENT_ID=...`), committa.
4. `git push` su `main` — la pipeline (**Deploy automatico**, più sotto) distribuisce
   `VanessaApp` e il frontend.

Una volta che il client id è nel repository, i deploy successivi non hanno più questo problema
d'ordine: `cd infra && npx cdk deploy --all --require-approval never` distribuisce i tre stack
insieme, e `npm run deploy` builda con il valore già presente.

Alla fine di questa sequenza ci sono l'infrastruttura e una pagina di accesso, ma **nessun
utente**: non c'è registrazione, e l'account si crea a mano. Il passo successivo è
**[Creare l'utente](#creare-lutente)**, più sotto.

#### Tre cose che il dominio di accesso pretende, e che nessun altro stack pretende

Il dominio personalizzato del pool è la risorsa più capricciosa del progetto. Non c'è niente da
fare a mano se le condizioni sono già soddisfatte — e oggi lo sono — ma se un deploy si pianta
qui, è quasi certamente una di queste tre.

- **`vanessa.matteo.cool` deve già avere un record A.** Cognito lo interroga prima di creare
  `auth.vanessa.matteo.cool` e rifiuta se il dominio padre non risolve. Il record c'è: è
  l'alias verso CloudFront che crea `VanessaApp`, e un alias A vale come record A a tutti gli
  effetti — nel DNS risponde con degli indirizzi, che è tutto quello che il controllo guarda.
  **Su un account vuoto, però, questo è un giro chiuso:** `VanessaApp` viene per ultimo perché
  legge gli output del pool, ma è lui a creare il record che il pool pretende. Se un giorno si
  riparte davvero da zero, il record A del dominio padre va creato a mano prima di
  `VanessaAccesso`, e `VanessaApp` poi se lo riprende.
- **La creazione richiede parecchio tempo.** Cognito tira su una distribuzione CloudFront tutta
  sua: il deploy resta fermo su `AWS::Cognito::UserPoolDomain` per diversi minuti, e la pagina
  può non rispondere subito nemmeno dopo che CloudFormation ha finito, il tempo che il DNS e la
  distribuzione si propaghino. Non è un blocco: va aspettato.
- **Sul pool può esserci una operazione sola alla volta.** Cognito rifiuta di creare o togliere
  un dominio mentre un'altra modifica al pool è in corso. In pratica significa non lanciare due
  deploy di `VanessaAccesso` in parallelo, e non lanciarne uno mentre si sta cambiando qualcosa
  sul pool dalla console o dalla CLI. Se capita, l'errore parla di una operazione concorrente e
  la cura è ritentare quando l'altra è finita.

E una quarta, solo se `VanessaAccesso` fosse già stato distribuito **prima** di questa modifica,
cioè con la pagina di accesso ancora su `turni-vanessa.auth.eu-south-1.amazoncognito.com`:
cambiare il dominio è per CloudFormation una sostituzione, e la sostituzione crea il nuovo prima
di togliere il vecchio — cioè prova a mettere due domini sullo stesso pool. Se il deploy fallisce
così, si toglie prima il dominio vecchio a mano e si rilancia:

```bash
aws cognito-idp delete-user-pool-domain \
  --region eu-south-1 \
  --domain turni-vanessa \
  --user-pool-id "$(aws cloudformation describe-stacks --stack-name VanessaAccesso \
      --query "Stacks[0].Outputs[?OutputKey=='IdPool'].OutputValue" --output text)"
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

La foto del foglio affisso in reparto le arriva su WhatsApp — non la scatta lei — e l'app
ne legge la sua riga.
La foto viene ridimensionata sul telefono a 2576px di lato lungo — il massimo
che il modello usa comunque — e spedita a una Lambda che chiede a Claude Sonnet
4.6 su Bedrock quali sigle ci sono nella riga intestata a Vanessa. Una lettura
prende fra i 18 e i 25 secondi.

Il ragionamento adattivo e' acceso e non e' un lusso: senza, il modello leggeva
la riga di luglio con tutti i codici giusti ma spostata di una colonna, e la
dava per certa. Trentuno colonne su un foglio fotografato storto non si contano
a colpo d'occhio.

L'endpoint di lettura **non scrive nessun turno**: restituisce una griglia, che
si corregge a schermo e si salva con la stessa rotta della sequenza scritta a
mano, revisione compresa. I giorni senza codice — le `x` di un mese iniziato a
metà — non si salvano e non cancellano niente.

Sta dietro una **Lambda Function URL** e non dietro API Gateway, che tronca
l'integrazione a 30 secondi: una lettura ne può prendere di più.

Il frontend chiama sempre la propria origine: `/api/...` e `/foto/leggi`,
inoltrati da CloudFront verso API Gateway e verso la Function URL. Un solo
dominio, niente da incollare in un file dopo il deploy. Le due origini non si
raggiungono più direttamente — con che forza, lo dice più sotto, dentro
**Autenticazione**.

Il sotto-path della lettura serve: la behaviour è `/foto/*`, e in CloudFront
l'asterisco vale zero o più caratteri **dopo** il prefisso letterale, quindi
`/foto` secco non la incontra e finisce sul bucket. La Lambda il path non lo
guarda.

Per questo il percorso foto non si prova più da `npm run dev`: il server di
sviluppo inoltra `/foto` alla Function URL così com'è, ma quella pretende una
firma SigV4 che solo CloudFront sa produrre, e rifiuta la richiesta non
firmata. In più `crypto.subtle`, con cui il browser calcola l'hash del corpo,
esiste solo in un contesto sicuro, e `http://localhost` non lo è in tutti i
browser. Una lettura vera va provata in linea.

Ogni lettura costa circa 0,09 €. L'endpoint è dietro lo stesso token verificato in
**Autenticazione** — la Lambda lo controlla per primo, prima della quota e prima di Bedrock —
quindi le difese sotto fermano un chiamante già autenticato che esagera, non sostituiscono quel
controllo: un **tetto di 10 letture al giorno** (contatore su DynamoDB, condizione e
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

Account `495133941005`, regione `eu-south-1`. I certificati stanno in `us-east-1` perché
CloudFront non ne accetta altrove — e un dominio personalizzato di Cognito è CloudFront sotto,
quindi vale anche per lui: da qui i tre stack.

| Stack | Contenuto |
|-------|-----------|
| `VanessaCertificato` | due certificati ACM (us-east-1): uno per `vanessa.matteo.cool`, uno per `auth.vanessa.matteo.cool` |
| `VanessaAccesso` | user pool Cognito, app client, dominio di accesso `auth.vanessa.matteo.cool` e il suo record DNS |
| `VanessaApp` | tabella, Lambda, API, bucket, distribuzione, record DNS |

Sono **due** certificati, non uno con un nome aggiuntivo. ACM non sa aggiungere un nome a un
certificato già emesso: cambiare l'elenco dei domini ne emette un altro e CloudFormation
sostituisce quello vecchio — e quello vecchio è il certificato che serve la distribuzione in
linea. Due costano zero e nessuno dei due può far cadere l'altro.

Il frontend non conosce l'endpoint dell'API: CloudFront lo inoltra da `/api`, e la distribuzione
lo legge dallo stack a ogni deploy. Se lo stack viene ricreato non c'è niente da aggiornare a mano.

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
nelle due regioni usate, e leggere gli output dei tre stack di questo progetto. Un altro
repository, o un altro branch di questo, non riesce ad assumerlo.

Se il repository viene ricreato da zero (non rinominato: gli ID restano), la condizione di
trust va aggiornata con i nuovi ID, altrimenti il deploy smette di funzionare — di proposito.

## Autenticazione

Si entra con la passkey: verifica biometrica obbligatoria, non basta che il telefono sia
sbloccato. Cognito, user pool `featurePlan: ESSENTIALS` (le passkey non esistono nel piano
Lite), Managed Login come pagina di accesso. La sessione dura un giorno **di proposito** — un
tocco di Face ID quando si apre l'app la mattina, non un rientro silenzioso che dura mesi se il
telefono va perso.

### La pagina di accesso sta su `auth.vanessa.matteo.cool`, e non è un dettaglio

La passkey è legata a un dominio — il *relying party id*, qui `vanessa.matteo.cool` — e il
browser la offre **solo** a una pagina servita da quel dominio o da un suo sottodominio.
Qualunque altra origine viene rifiutata dal browser prima ancora di chiedere il volto.

Il pool ha quindi un dominio suo, `auth.vanessa.matteo.cool`, con il suo certificato e il suo
record DNS. Il dominio gratuito di Cognito — `turni-vanessa.auth.eu-south-1.amazoncognito.com`,
che è quello che questo progetto usava all'inizio — non funzionerebbe: `vanessa.matteo.cool` non
è un sottodominio di `amazoncognito.com`, il browser non offre nessuna passkey, e quello che
resta è una pagina di accesso con la casella della password. Cioè non la funzionalità.

L'altra strada — legare le passkey al dominio di Amazon — è stata scartata: le credenziali
registrate su un dominio che non controlliamo andrebbero registrate di nuovo, **su ogni
dispositivo**, il giorno in cui ci si sposta da lì.

Le tre cose insieme (`passkeyRelyingPartyId` sul pool, il dominio di accesso, `VITE_LOGIN_DOMAIN`
nel frontend) devono restare coerenti, e un test le controlla: `infra/test/auth-stack.test.ts`
verifica che il relying party id sia un suffisso registrabile del dominio di accesso,
`web/test/config.test.ts` che il valore committato punti sotto `vanessa.matteo.cool`.

### La pagina di accesso è Managed Login, e ha un aspetto diverso dall'Hosted UI

Il dominio è configurato su `ManagedLoginVersion` 2. **Non è una scelta estetica:** la
documentazione AWS dice che «passkey sign-in isn't available in the classic hosted UI», e la
versione classica è quella che Cognito userebbe di default. Con quella, il dominio giusto
servirebbe comunque una pagina che la passkey non la offre mai.

La conseguenza visibile è che la pagina di accesso **non è quella vecchia di Cognito**: Managed
Login ha un impaginato diverso, più moderno, con il tema chiaro/scuro. Se sembra una pagina mai
vista, è quella giusta.

Insieme al dominio c'è una **risorsa di branding** (`AWS::Cognito::ManagedLoginBranding`) con i
valori predefiniti di Cognito. Serve perché Managed Login non serve niente a un app client che
non ne ha uno, e Cognito lo crea da sé solo per i client creati dalla console — il nostro lo crea
CloudFormation. Non c'è niente da personalizzare lì: è un prerequisito, non una decorazione.

**Una password esiste comunque.** L'API di Cognito la dichiara obbligatoria — non si può
togliere — anche se non è la strada normale per entrare. Il pavimento della sicurezza dell'app è
la sua forza, non il volto: lo stack impone almeno 32 caratteri con tutte e quattro le classi
(maiuscole, minuscole, numeri, simboli), quindi va generata da un gestore di password, non a
memoria, e conservata lì — mai digitata.

### Il perimetro vero è la casella email di Vanessa

Passkey e password non sono le uniche due strade d'accesso: c'è anche il codice una-tantum via
email, ed è un accesso completo e permanente — non solo per il primo ingresso. La passkey quindi
**non fa da cancello a niente**: è la più comoda delle tre strade, non l'anello più forte di una
catena.

Chi ha accesso alla casella di posta di Vanessa ha accesso all'app, volto o non volto. Il Face ID
è la porta di tutti i giorni; la casella è il perimetro vero. È una conseguenza del bootstrap, non
una svista — senza il codice via email non ci sarebbe modo di registrare la prima passkey né di
rientrare da un telefono nuovo o perso — spiegata per esteso in
`docs/superpowers/specs/2026-08-02-autenticazione-passkey-design.md`.

### Creare l'utente

Il passo che segue **[Primo deploy](#primo-deploy--e-ogni-volta-che-vanessaaccesso-viene-ricreato)**:
lì finisce l'infrastruttura, qui comincia l'unico account che esiste.

Non c'è registrazione: l'utente si crea a mano, con l'AWS CLI.

```bash
aws cognito-idp admin-create-user \
  --region eu-south-1 \
  --user-pool-id "$(aws cloudformation describe-stacks --stack-name VanessaAccesso \
      --query "Stacks[0].Outputs[?OutputKey=='IdPool'].OutputValue" --output text)" \
  --username vanessa@esempio.it \
  --user-attributes Name=email,Value=vanessa@esempio.it Name=email_verified,Value=true
```

Tre cose sorprendono, se non si sa già:

- **La password temporanea dura 24 ore.** Un utente creato che non completa la sfida sotto
  entro un giorno ha la password morta, e va riemessa con lo stesso comando qui sopra più
  `--message-action RESEND` in coda:

  ```bash
  aws cognito-idp admin-create-user \
    --region eu-south-1 \
    --user-pool-id "$(aws cloudformation describe-stacks --stack-name VanessaAccesso \
        --query "Stacks[0].Outputs[?OutputKey=='IdPool'].OutputValue" --output text)" \
    --username vanessa@esempio.it \
    --user-attributes Name=email,Value=vanessa@esempio.it Name=email_verified,Value=true \
    --message-action RESEND
  ```

  Senza `RESEND`, Cognito rifiuta con `UsernameExistsException` perché l'utente esiste già.
  `RESEND` manda una nuova email con una nuova password temporanea, esattamente come la prima
  volta. `admin-set-user-password` è un'alternativa che funziona, ma **non manda nessuna
  notifica**: la password nuova va comunicata a mano a chi deve completare la sfida sotto.
- **Subito dopo la creazione (o la riemissione), la sfida `NEW_PASSWORD_REQUIRED` pretende una
  password sostitutiva di almeno 32 caratteri, con tutte e quattro le classi.** Non c'è un
  comando CLI per soddisfarla: si fa dalla pagina di Managed Login, con lo username e la
  password temporanea appena arrivata via email — ed è **chi ha appena eseguito il comando** a
  completarla lì per lì, non Vanessa. Il gestore di password va tenuto **aperto in quel
  momento**, non riaperto dopo per salvarci qualcosa già scelto al volo. Non va confuso col
  primo accesso di Vanessa, sotto: sono due passi separati, in due momenti diversi, di solito
  fatti da due persone diverse.
- **Il reset della password è solo da amministratore.** `accountRecovery` è `NONE`: non c'è un
  "password dimenticata" nella pagina di login. Una password persa si recupera entrando col
  codice via email, oppure la resetta chi ha le credenziali AWS dell'account
  (`admin-set-user-password`).

Poi, separatamente: il primo accesso di Vanessa dal telefono, col codice una-tantum via email —
da lì si registra la passkey. Ogni dispositivo nuovo rifà lo stesso giro: codice via email, poi
passkey su quel dispositivo.

### Le due origini restano protette, ma è una domanda diversa

Oltre all'autenticazione resta il segreto d'origine introdotto quando l'app era ancora aperta a
chiunque (`docs/superpowers/specs/2026-08-02-api-dietro-cloudfront-design.md`): risponde a *da
quale porta sei entrato*, non a *chi sei*, e le due cose non si sostituiscono a vicenda. Le due
origini non si raggiungono più direttamente, ma non con la stessa forza — e la differenza conta,
quindi sta scritta:

- **`/foto` è chiuso davvero.** La Function URL è su `AWS_IAM` dietro Origin Access Control:
  CloudFront firma ogni richiesta con SigV4 e il permesso di invocazione è ristretto a questa
  distribuzione. Senza la firma non si entra, e la firma non si indovina. Per questo una
  richiesta POST deve portare `x-amz-content-sha256` con lo SHA-256 del corpo: Lambda non accetta
  payload non firmati, e CloudFront firma con l'hash che il browser gli ha dato.
- **`/api` è chiuso più debolmente.** Un HTTP API non ha resource policy — è una funzionalità dei
  REST API — quindi al suo posto CloudFront inietta un header con un segreto condiviso, e l'API
  rifiuta con 401 chi non lo porta. È un segreto al portatore: chi lo ottiene lo può rigiocare
  quante volte vuole, da dove vuole. Ferma gli scanner e l'accesso diretto casuale, che è quello
  per cui c'è. Non è una barriera crittografica e non va scambiata per tale.

Restano anche le difese di prima: il throttling su API Gateway (100 richieste al secondo) — il
freno contro chi è autenticato ma martella l'API più veloce di quanto farebbe una persona, non
contro chi non lo è, che l'authorizer ferma prima — e il point-in-time recovery sulla tabella,
che permette di tornare indietro dopo un danno.

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
