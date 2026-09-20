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
**non va sistemato inventando un valore.** Oggi tutti e due sono compilati: `VanessaAccesso` è
distribuito e `VITE_CLIENT_ID` porta il suo `IdClient`. Erano vuoti di proposito finché il pool
non esisteva, e se un giorno il pool viene ricreato tornano a esserlo — l'unica cosa giusta,
allora, è rifare la sequenza sotto.

`VITE_LOGIN_DOMAIN` invece è già compilato e non va toccato: vale
**`https://auth.vanessa.matteo.cool`**, cioè la pagina di accesso sul nostro dominio, non su
`amazoncognito.com`. Il perché sta in **Autenticazione**, e non è una preferenza estetica: questo
host è anche l'identità a cui ogni passkey resta legata, e su un indirizzo Amazon sarebbero legate
a un dominio che non controlliamo. La guardia controlla che sia un'origine
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
| **Calendario** | griglia mensile, CRUD completo del giorno: turno, turno originale, collega, tipo di scambio, note. Il puntino accanto al codice segnala uno scambio. Da qui si esporta il mese nel calendario del telefono. |
| **Carica** | leggi il mese da una foto del foglio, oppure scrivi la sequenza dei codici. In entrambi i casi mostra quali giorni sovrascriverebbe **prima** di salvare. |
| **Scambi** | saldo favori e saldo ore per collega, come il foglio Scambi. |
| **Riepilogo** | due grafici ad anello (ore per turno, giorni per codice), ore per mese a barre, tabella per codice. |
| **Stipendio** | parametri e simulazione mensile. |
| **Profilo** | dall'icona in alto a destra, non dalla barra in basso: account, dati personali, contratto, i parametri di paga in sola lettura, versione e letture della foto di oggi. |

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

## Il corpo di `/config`

`PUT /api/config` accetta `{ pay }`, `{ profile }`, o tutti e due, e scrive **solo le chiavi
che riceve**. I due finiscono su righe diverse della tabella (`sk = PAY` e `sk = PROFILE`), ed
è questo che permette a una rotta sola di servirli entrambi: salvare il profilo non può
azzerare la tariffa oraria, perché non tocca quella riga.

Un corpo **senza** nessuna delle due chiavi si legge come un `PaySettings` nudo — la forma che
questa rotta riceveva prima che il profilo esistesse. Non è compatibilità per gusto: la app è un
bundle in cache su un telefono, e dopo un deploy può continuare a mandare la forma vecchia per
un po'. Toglierlo produce un errore che in sviluppo non si vedrebbe mai.

`GET /api/config` restituisce `{ pay, profile, quota: { used } }`. Il massimo giornaliero non
viaggia: `MAX_READINGS_PER_DAY` sta in `core`, che il frontend importa già.

Le **ore settimanali da contratto** si mostrano e basta: nessun conteggio le legge. Collegarle
alle ore lavorate vuol dire decidere cosa fare di mesi iniziati a metà, festivi, malattia e
ferie — e di queste ultime il modello dati non sa niente. È una spec sua.

## I turni nel calendario dell'iPhone

Il pulsante **Esporta nel calendario**, nella vista Calendario, scarica il mese che si sta
guardando come file `.ics`. Su iPhone il file finisce in *File*, e da lì si apre in Calendario.

Il pulsante è spento quando non c'è niente da esportare. Un mese di soli `L` conta come vuoto:
`Libero` non ha orari, quindi non diventa un evento.

**Gli orari non hanno fuso.** Escono come `20260813T070000`, senza `Z` e senza `TZID`: lo standard
la chiama ora *fluttuante* e il telefono la legge nel proprio fuso. Le sette del mattino restano le
sette del mattino, senza conversioni e quindi senza aritmetica sull'ora legale — che è il pezzo che
si sbaglia in modo invisibile e si scopre rotto l'ultima domenica di marzo. Il prezzo è che su un
telefono impostato su un altro fuso il turno si legge comunque alle 07:00 locali.

**La sveglia sta solo sui turni del mattino**, dodici ore prima: le 19:00 della sera prima per un
turno che comincia alle 07:00. Sui pomeriggi non c'è, e non è una dimenticanza: dodici ore prima
delle 13:00 è l'una di notte.

### Se dopo aver riesportato compaiono i doppioni, o non cambia niente

Ogni evento ha un identificatore costruito dalla data — `turno-2026-08-13@vanessa.matteo.cool` —
che non cambia fra un'esportazione e l'altra, ed è la condizione perché Calendario aggiorni gli
eventi invece di aggiungerli una seconda volta. In più `SEQUENCE` cresce a ogni esportazione, ed è
il numero che i client guardano per capire che un evento è una versione più nuova. Il contatore sta
in `localStorage`, per mese e per dispositivo.

È la condizione necessaria, non la garanzia: come iOS si comporta all'importazione non è
verificabile senza il telefono. **Se i doppioni arrivano lo stesso**, si cancellano gli eventi di
quel mese dal calendario e si reimporta il file. Non c'è niente da sistemare nell'app.

C'è anche il guasto opposto, silenzioso: `SEQUENCE` riparte da zero ogni volta che `localStorage`
è vuoto su questo dispositivo — non solo passando a un telefono diverso, ma anche cancellando i
dati del sito, aprendo una scheda privata, o partendo da un profilo del browser nuovo sullo stesso
telefono. Un file con `SEQUENCE:0` che arriva su un calendario che per quegli eventi ha già una
`SEQUENCE` più alta è, per il client, una versione **più vecchia** dell'evento che ha già, e la
ignora: nessun errore, nessun doppione, e il turno che si era corretto resta quello di prima.
**Se dopo aver riesportato non cambia niente**, è questo il sospetto numero uno, e il rimedio è lo
stesso di sopra: si cancellano gli eventi di quel mese dal calendario e si reimporta il file.

### Quello che non fa

Non è un calendario sottoscritto che si aggiorna da solo. Una sottoscrizione di iOS non sa
autenticarsi — niente OAuth, niente passkey, niente header — quindi l'indirizzo dovrebbe funzionare
senza accesso e portare un segreto nell'URL, e chiunque avesse quel link leggerebbe i turni per
sempre. Un'app che si è chiusa col volto non apre una porta laterale sui dati che protegge. Il
ragionamento per esteso sta in `docs/superpowers/specs/2026-08-13-turni-nel-calendario-design.md`.

Non esporta le ore corrette a mano: l'app sa che la **durata** è cambiata, non **quale estremo** si
è spostato. Il calendario porta gli orari del turno, la correzione resta nel cartellino.

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
ne legge ogni riga.
La foto viene ridimensionata sul telefono a 2576px di lato lungo — il massimo
che il modello usa comunque — e spedita a una Lambda che chiede a Claude Sonnet
4.6 su Bedrock quali sigle ci sono in ogni riga del foglio. Una lettura
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
dominio, niente da incollare in un file dopo il deploy. L'API non si raggiunge più
direttamente; la Function URL sì, e la sua unica porta è il token — con che forza ciascuna delle
due, lo dice più sotto, dentro **Autenticazione**.

Il sotto-path della lettura serve: la behaviour è `/foto/*`, e in CloudFront
l'asterisco vale zero o più caratteri **dopo** il prefisso letterale, quindi
`/foto` secco non la incontra e finisce sul bucket. La Lambda il path non lo
guarda.

Il percorso foto non si prova da `npm run dev`, ma non perché l'origine
rifiuti: la Function URL è su `authType: NONE` e risponde a chiunque. È che da
`npm run dev` non si entra affatto — vedi *«`npm run dev` non fa accedere»*
qui sotto — quindi la richiesta parte senza token e la Lambda la rifiuta per
prima cosa. Una lettura vera va provata in linea.

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

### I turni degli altri

La lettura prende **tutte le righe** del foglio, non solo quella di Vanessa. La sua va nella
griglia correggibile di sempre; le altre finiscono in un blocco richiudibile, in sola lettura, che
dice quante persone ha letto.

Le sigle degli altri si conservano **così come sono scritte**, anche quelle che l'app non conosce
(`F`, `R`, `C`, `N1`). Dove la sigla è una delle cinque note, il calendario sa gli orari e può
dire chi condivide le ore; dove non lo è, mostra la lettera e tace. Una sigla nuova non rompe
l'import: è il motivo per cui non entrano in `ShiftCode`.

Nel calendario il numero in un giorno conta **chi si sovrappone alle sue ore**, non chi c'è. `M`
finisce quando `P` comincia: si danno il cambio, non si incontrano. Toccando il giorno, i nomi si
dividono fra *Con te* e *Quel giorno*.

**Se una riga risulta letta male**, non si corregge: si rifà la foto. La nuova lettura sostituisce
il mese per intero — chi è sparito dal foglio sparisce dal calendario — mentre i suoi turni non si
cancellano mai. Le due regole sono opposte perché i due dati lo sono: il suo è l'originale, il
resto è la copia di un foglio che viene riemesso.

**Cosa viene conservato.** Il turnario completo del reparto, con i nomi come stanno sul foglio.
Sta dietro la passkey come tutto il resto, non lascia l'account, e **non entra nel file `.ics`**:
quello si manda in giro per natura, e i turni di altri non devono viaggiarci dentro.

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
`cdk deploy`, poi verifica che il sito risponda 200 e che l'API risponda **401**. Il 401 è
l'esito giusto: la pipeline non ha un token, e tutte e cinque le rotte stanno dietro
l'authorizer JWT. Guarda anche il `content-type` del rifiuto, perché un 401 in `text/html`
vorrebbe dire che la behaviour `/api/*` non combacia più e a rispondere è la SPA. La stessa
chiamata all'hostname dell'API in proprio deve dare 401 anche lei: prova che l'authorizer è
sulle rotte e non solo sul percorso attraverso CloudFront. **Non** prova che il segreto
d'origine sia collegato a tutte e due le parti — l'authorizer rifiuta prima che il controllo sul
segreto venga eseguito, e per arrivarci servirebbe un token valido, che in CI non c'è — è la
voce 5 di *Cosa solo un deploy può dire*, dentro **Autenticazione**, insieme a come farla a
mano. Sulle pull request girano solo i test. Il deploy si puo' anche lanciare a mano da GitHub
(*Run workflow*).

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

La passkey è legata a un dominio — il *relying party id* — e qui quel dominio è
**`auth.vanessa.matteo.cool`**, cioè esattamente la pagina di accesso. Non il dominio della app.
Le regole in gioco sono due, e quella che comanda è la più stretta:

- **Il browser** accetta un relying party id che sia l'host della pagina di login o un dominio
  di cui quell'host è sottodominio.
- **Cognito** è più stretto: con un dominio personalizzato e Managed Login pretende che il
  relying party id sia *il nome completo del dominio personalizzato*. Uguale, non «sotto».

`vanessa.matteo.cool` soddisfarebbe solo la prima, quindi non basta — ed è il motivo per cui
questo valore non va «semplificato» al dominio della app: il browser sarebbe contento e Cognito
no, e nessun test verde lo direbbe.

Il pool ha quindi un dominio suo, con il suo certificato e il suo record DNS. Il dominio
gratuito di Cognito — `turni-vanessa.auth.eu-south-1.amazoncognito.com`, quello che il progetto
usava all'inizio — soddisferebbe la regola di Cognito ma legherebbe ogni credenziale a un nome
che non controlliamo: le passkey andrebbero registrate di nuovo, **su ogni dispositivo**, il
giorno in cui ci si sposta da lì. Per questo il dominio di accesso sta sotto
`vanessa.matteo.cool`.

**Cambiare il relying party id invalida tutte le passkey già registrate**, una per dispositivo.
Oggi non costa niente perché nessun utente esiste ancora; dopo il primo accesso di Vanessa
costa un giro di registrazioni su ogni telefono.

Le tre cose insieme (`passkeyRelyingPartyId` sul pool, il dominio di accesso, `VITE_LOGIN_DOMAIN`
nel frontend) sono lo **stesso nome scritto tre volte** e devono restare coerenti. Tre test lo
controllano: `infra/test/auth-stack.test.ts` verifica che il relying party id sia identico al
dominio del pool, `web/test/config.test.ts` che il valore committato nel frontend sia quell'host,
e `infra/test/config.test.ts` confronta le prime due — costruite dal vero `CONFIG` di
`infra/bin/config.ts` — con il `.env.production` del frontend. Serviva il terzo, e per due
motivi diversi: `web/test/config.test.ts` fissa un literal, quindi non vede il pool muoversi;
`infra/test/auth-stack.test.ts` importa lo stesso `CONFIG` che costruisce il pool, quindi le due
copie lato-stack si muovono insieme e restano d'accordo fra loro anche quando il valore è
sbagliato. Cambiare `CONFIG.loginDomain` da solo li lasciava entrambi verdi.

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

### `npm run dev` non fa accedere, e non è un guasto

**Da `npm run dev` non si entra nell'app, e non c'è niente da compilare per farlo funzionare.**
Sta scritto qui perché la conclusione naturale davanti a una pagina vuota è che manchi un
valore, e riempirlo peggiora le cose invece di sistemarle.

Il client registra un solo indirizzo di ritorno, `https://vanessa.matteo.cool/`, mentre il
browser da `npm run dev` chiede di tornare su `http://localhost:5173/`. Managed Login risponde
`redirect_mismatch` sulla propria pagina e non torna indietro. Con `VITE_CLIENT_ID` vuoto —
com'è, e come deve restare in `.env.development` — non si arriva neanche a quel punto: l'app
mostra «Configurazione di accesso mancante» e si ferma lì.

**Perché `http://localhost:5173/` non è stato aggiunto ai `callbackUrls`**, che sarebbe una riga:
perché non basterebbe. Il proxy di sviluppo (`web/vite.config.ts`) manda `/api` all'hostname di
API Gateway, che rifiuta chi non porta il segreto d'origine iniettato da CloudFront — e quel
segreto in locale non c'è. L'accesso funzionerebbe e l'app resterebbe vuota, con un 401 a ogni
chiamata: una mezza correzione che costa una risorsa in più su un pool di produzione e lascia
esattamente lo stesso schermo bianco. Se un giorno serve davvero lo sviluppo in locale contro i
dati veri, va rimessa in piedi tutta la catena — indirizzo di ritorno **e** una via per `/api` —
non solo il primo pezzo.

Quello che resta in locale è `npm test`: le viste, il calcolo delle ore e dello stipendio,
l'accesso e il cancello sono coperti lì, con un'API finta e un `fetch` finto. Da `npm run dev`
oggi non si vede l'app — nemmeno per lavorare sul disegno delle pagine — perché il cancello non
disegna niente senza sessione. Il percorso vero si prova in linea, dopo il deploy.

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

**Non arriva nessuna email, e non c'è nessuna password temporanea.** È la cosa che sorprende, e
va letta prima di andare a cercare in posta: l'utente nasce **`CONFIRMED`**, non
`FORCE_CHANGE_PASSWORD`. Il motivo è che il pool ha `EMAIL_OTP` fra i primi fattori — ce l'ha di
proposito, perché una passkey non si registra su un account che non esiste ancora — e il comando
sopra non passa `--temporary-password`. Cognito allora crea un account già usabile, **senza
password**, e non ha niente da spedire.

Quindi non c'è la scadenza di 24 ore, non c'è `--message-action RESEND` da usare, e non c'è
nessuna sfida `NEW_PASSWORD_REQUIRED` da completare al posto suo. Chi crea l'utente ha finito
qui.

Se invece si passa `--temporary-password`, si torna nel giro classico: email di invito, password
valida un giorno (`UnusedAccountValidityDays: 1`), e la sfida `NEW_PASSWORD_REQUIRED` che
pretende una password di almeno 32 caratteri con tutte e quattro le classi. Non serve, e per una
persona sola è solo un passaggio in più da sbagliare.

Due cose restano vere e vale la pena sapere:

- **Una password non esiste finché qualcuno non la mette.** `PASSWORD` è fra i primi fattori
  perché Cognito lo pretende, non perché sia la strada normale. Chi ne vuole una la imposta con
  `admin-set-user-password --permanent`, che però **non manda nessuna notifica**: va comunicata a
  mano. Il pool ne pretende almeno 32 caratteri con maiuscole, minuscole, numeri e simboli,
  quindi va generata da un gestore di password e conservata lì, mai digitata a memoria.
- **Il reset è solo da amministratore.** `accountRecovery` è `NONE`: non c'è nessun «password
  dimenticata» nella pagina di accesso. Chi resta fuori rientra col codice via email, oppure
  glielo risolve chi ha le credenziali AWS dell'account.

Il primo accesso lo fa lei, dal telefono: apre l'app, scrive la sua email, chiede il **codice
una-tantum via email** — quella sì che arriva, ed è il primo momento in cui Cognito scrive a
qualcuno. Ogni dispositivo nuovo rifà lo stesso giro.

#### La passkey non si registra da sola, e per una settimana non si è registrata affatto

Questa riga diceva «e da lì registra la passkey», dando per scontato che dopo il codice via email
Cognito lo proponesse. **Non lo propone**, e AWS lo scrive senza giri di parole: Cognito non
chiede di impostare una passkey a chi ha già un account e non ne ha una, né a chi è stato creato
**da un amministratore**. Vanessa è tutte e due le cose, perché `admin-create-user` è la procedura
che questo stesso file prescrive poche righe più su.

Siccome una passkey non si può *usare* prima di averla *registrata*, il risultato è che si entra
sempre col codice via email — con il pool configurato alla perfezione. Ed era configurato alla
perfezione: relying party id giusto, `required`, Managed Login v2, `ALLOW_USER_AUTH`, `WEB_AUTHN`
fra i primi fattori. Non c'era niente di rotto da cercare: mancava un passo che nessuno faceva.

La registrazione sta su una pagina a parte di Managed Login, e ci si arriva solo se qualcosa ci
manda:

```
https://auth.vanessa.matteo.cool/passkeys/add?client_id=<IdClient>&redirect_uri=https%3A%2F%2Fvanessa.matteo.cool%2F
```

Cognito autorizza quella pagina con il **cookie di sessione** lasciato dall'accesso, non con un
token: quindi prima si entra col codice via email, e poi si apre il link **dallo stesso browser**.
Nell'app il link sta nel **Profilo**, blocco *Account*, ed è da lì che conviene usarlo.

**Va rifatto su ogni telefono**: la passkey resta sul dispositivo dove è stata creata.

### Le due origini, e perché una sola delle due è protetta

Oltre all'autenticazione resta il segreto d'origine introdotto quando l'app era ancora aperta a
chiunque (`docs/superpowers/specs/2026-08-02-api-dietro-cloudfront-design.md`): risponde a *da
quale porta sei entrato*, non a *chi sei*, e le due cose non si sostituiscono a vicenda. Le due
origini però non sono affatto nella stessa condizione, e la differenza conta abbastanza da
stare scritta per esteso:

- **`/foto` non è chiuso affatto.** La Function URL è su `authType: NONE`, senza Origin Access
  Control (`infra/lib/app-stack.ts`, che racconta anche perché l'OAC è stato tolto): chiunque ne
  conosca l'indirizzo la raggiunge. **La sua unica porta è il token**, che la Lambda verifica da
  sé, per prima, prima della quota e prima di Bedrock (`api/src/token.ts`). Non c'è un secondo
  strato dietro: quel controllo non è ridondante e non va allentato «per un momento» mentre si
  indaga un 401. Se cade, l'endpoint che chiama Bedrock è aperto al mondo.
- **`/api` è chiuso, debolmente, e per una domanda diversa.** Un HTTP API non ha resource policy —
  è una funzionalità dei REST API — quindi al suo posto CloudFront inietta un header con un
  segreto condiviso, e l'API rifiuta con 401 chi non lo porta. È un segreto al portatore: chi lo
  ottiene lo può rigiocare quante volte vuole, da dove vuole. Ferma gli scanner e l'accesso
  diretto casuale, che è quello per cui c'è. Non è una barriera crittografica e non va scambiata
  per tale. Sotto di esso, e indipendente da esso, c'è l'authorizer JWT su tutte e cinque le
  rotte.

Restano anche le difese di prima: il throttling su API Gateway (100 richieste al secondo) — il
freno contro chi è autenticato ma martella l'API più veloce di quanto farebbe una persona, non
contro chi non lo è, che l'authorizer ferma prima — e il point-in-time recovery sulla tabella,
che permette di tornare indietro dopo un danno.

### Cosa solo un deploy può dire, e in che ordine guardarlo

Tutto quello che questo repository verifica lo verifica contro un template CloudFormation
sintetizzato o contro una finestra `jsdom`. Nessuno dei due vede una pagina disegnata, una
richiesta vera a CloudFront, o l'opinione di Cognito su una configurazione. Questo elenco è
quello che resta fuori, in ordine. **I tre difetti che questa funzionalità ha avuto — il dominio
di accesso, la versione di Managed Login, il relying party id — sono usciti tutti da questo modo
di guardare, cioè dal chiedersi cosa il verde dei test non stia provando; nessuno dei tre l'ha
trovato un test.** Vale la pena rifare l'elenco a ogni modifica del pool, non solo la prima
volta.

**0. Che il 401 di API Gateway porti `content-type: application/json`.** Prima perché si
manifesta da sé, subito e senza che nessuno vada a cercarlo: se l'assunzione è sbagliata, il job
Deploy è rosso al primo push. Il passo stampa il `content-type` che ha visto prima di uscire,
quindi la diagnosi è una riga di log e la correzione una riga di YAML.

**1. Che la pagina di Managed Login offra davvero la passkey.** Prima fra le cose da andare a
guardare, e per una ragione che nessun'altra voce ha: **cambiare `passkeyRelyingPartyId`
invalida ogni passkey già registrata**, una per dispositivo. Oggi nessun utente esiste e
correggere non costa niente; dal primo accesso di Vanessa in poi costa un giro di registrazioni
su ogni telefono che ha. Quindi va guardato nella finestra fra il deploy e il suo primo accesso.
Sulla carta ogni ingrediente è a posto e ognuno ha il suo test — relying party id uguale al
dominio, `ManagedLoginVersion: 2`, risorsa di branding legata al nostro client,
`UserPoolTier: ESSENTIALS`, `WEB_AUTHN` fra i primi fattori, `ALLOW_USER_AUTH` sul client — ma
sei impostazioni giuste non sono la settima cosa, cioè la pagina.

Come: dopo il deploy di `VanessaAccesso`, aprire

```
https://auth.vanessa.matteo.cool/login?client_id=<IdClient>&response_type=code&scope=openid+email&redirect_uri=https://vanessa.matteo.cool/
```

e confermare tre cose: (a) che la pagina si disegni — è la prova che
`useCognitoProvidedValues: true` da solo basta, cioè la voce 4 di questo elenco; (b) che sia
l'impaginato di Managed Login e non l'Hosted UI classica; (c) che una passkey venga offerta. Se
manca una delle tre, si corregge **prima** di creare l'utente.

**2. Che CloudFront inoltri `Authorization` a tutte e due le origini.** È l'ignoto con il raggio
più largo e la prova più economica. `ALL_VIEWER_EXCEPT_HOST_HEADER` su `/api/*` e `/foto/*`
dovrebbe inoltrare ogni header del viewer tranne `Host`, e la cache è disattivata, ma il
trattamento di `Authorization` da parte di CloudFront ha abbastanza storia da meritare un curl.
Se non lo inoltra, il token non arriva né all'authorizer né a `requireSignedIn`, ogni chiamata
risponde 401, e quello che lei vede è la frase del cancello — non i dati. Come: preso un token
da un accesso vero (devtools, `localStorage.sessione`),
`curl -H "authorization: Bearer <id token>" https://vanessa.matteo.cool/api/config` → 200 con
JSON, e lo stesso verso `/foto/leggi` con un corpo minuscolo → qualsiasi cosa tranne 401.

**3. Che lo scambio del codice funzioni contro il dominio personalizzato.** `completaAccesso` e
`rinnovaAccesso` fanno `POST` a `https://auth.vanessa.matteo.cool/oauth2/token` da una pagina su
`https://vanessa.matteo.cool`: è cross-origin e vuole un `Access-Control-Allow-Origin` da
Cognito. I client pubblici lo ricevono, ma la combinazione dominio personalizzato + Managed
Login v2 non è qualcosa su cui `jsdom` con un `fetch` finto abbia un'opinione. Se fallisce: Face
ID riesce, il browser torna con `?code=`, e lo scambio del codice non produce una sessione. Il
breaker non lo vede: quello conta i 401 di `api.ts`, e qui all'API non si arriva mai.

**Quello che lei vede, se succede, è comunque una frase.** Il cancello conta i viaggi verso
`/oauth2/authorize`: il primo che torna a mani vuote si ripete, perché una connessione caduta
sulla via del ritorno è il caso ordinario e un secondo tentativo la cura da sé; se anche il
secondo non produce una sessione, si ferma. Dice di ricaricare, e che se il messaggio ricompare
è un problema di configurazione e non qualcosa che ha sbagliato lei. Ricaricare è una mossa
vera: se il guasto era transitorio l'URL ha ancora `?code=` e il codice non era mai arrivato a
Cognito, quindi il secondo scambio riesce. Se invece è il CORS, il codice è stato consumato lo
stesso — il `POST` allo `/oauth2/token` non ha preflight, quindi parte e viene eseguito anche
quando il browser poi nasconde la risposta — e la ricarica ricade su `invalid_grant`, con lo
stesso messaggio e il motivo scritto in console. Ci finisce in console su tutti e tre i modi in
cui lo scambio può fallire, non solo su quello. Quindi questa voce non è un guasto muto: è una
cosa da verificare perché se è rotta l'app non si usa affatto, non perché sia difficile
accorgersene.

**4. Che `useCognitoProvidedValues: true` da solo basti** perché Managed Login serva qualcosa.
La documentazione AWS indica `CreateManagedLoginBranding` come il requisito e questo flag come
«applica i valori predefiniti di Cognito», che è quello che lo stack fa. Solo una pagina
disegnata lo prova: il punto (a) della voce 1 è quella prova.

**5. Che il segreto d'origine sia collegato a tutte e due le parti.** La pipeline **non** lo
copre più, e c'è scritto perché nel passo stesso: l'authorizer rifiuta prima che il controllo sul
segreto venga eseguito, quindi senza un token valido quel 401 si ottiene identico anche a
segreto scollegato. Con un token vero:
`curl -H "authorization: Bearer <id token>" <UrlApi>/api/config` chiamando l'API **per nome**
deve dare 401; la stessa chiamata attraverso `https://vanessa.matteo.cool` deve dare 200.

**6. Se `VanessaAccesso` esiste già — chiusa.** Non esisteva, verificato con
`aws cloudformation describe-stacks --stack-name VanessaAccesso --region eu-south-1` prima del
deploy invece che durante. Nessun dominio a prefisso da sostituire, quindi la via d'uscita
`delete-user-pool-domain` non è servita. Resta qui perché la domanda torna identica il giorno in
cui il pool venisse ricreato.

**7. Se la validazione ACM finisce in tempo — chiusa per come si distribuisce davvero.**
`VanessaCertificato` da solo ha emesso e validato via DNS il certificato di
`auth.vanessa.matteo.cool` in meno di tre minuti, e `VanessaAccesso` è partito dopo, a
certificato già emesso. Il dubbio riguardava un `--all` a freddo, che la sequenza manuale di
*Primo deploy* evita per costruzione: la prima volta conviene ancora seguire quella.

**8. Che la sessione da 24 ore si rinnovi davvero.** `ALLOW_REFRESH_TOKEN_AUTH` viene emesso —
verificato leggendo il codice di CDK — quindi il template del client è giusto. Quello che non è
provato è la promessa costruita sopra: un Face ID la mattina e silenzio per il resto della
giornata. L'unica cosa che esercita `rinnovaAccesso` è un test `jsdom` con un `fetch` finto. La
prima prova vera è Vanessa che apre l'app nel pomeriggio e non le viene chiesto niente.

**9. Quando Cognito applichi la regola sul `RelyingPartyId`** — se al momento della
configurazione o al momento della sfida. Resta in elenco solo perché nessuno la riapra: il
valore distribuito soddisfa sia la regola WebAuthn sia quella di Cognito, quindi non può essere
lui a rompere.

## Modello dati

Una tabella sola, chiave composta:

| Entità | `pk` | `sk` |
|--------|------|------|
| Turno | `TURNI#2026` | `2026-01-15` |
| Parametri paga | `CONFIG` | `PAGA` |
| Turnario | `ROSTER#<anno>` | `<MM>` |

Le ore non si memorizzano: si derivano dal codice turno. Un giorno senza turno non esiste come
item — l'assenza è l'assenza, non una riga vuota.

`ROSTER#<anno>` / `<MM>` — il turnario del mese: una riga per persona, le sigle unite da virgole.

## Il generatore Python

`genera_presenze.py` nella radice del repository resta per produrre l'xlsx. Non è più la fonte
di verità e non è collegato alla app.
