# I turni nel calendario dell'iPhone

Data: 2026-08-13
Stato: approvato

## Obiettivo

Un pulsante che scarica il mese come file `.ics`, da aprire in Calendario sull'iPhone.

I turni oggi si guardano solo dentro l'app. Il telefono però ha già un calendario, ed è quello
che guarda quando qualcuno le chiede se è libera giovedì. Finché i turni stanno solo qui, la
risposta richiede di aprire un'altra app e cercare il giorno.

## Cosa questo NON fa

**Non è un calendario che si aggiorna da solo.** Il file è un'istantanea: se un turno cambia, il
mese va riesportato. L'alternativa — un calendario sottoscritto via `webcal:` che iOS ricarica da
sé — è stata considerata e scartata, e la ragione non è la fatica.

Una sottoscrizione di iOS **non sa autenticarsi**: niente OAuth, niente passkey, niente header.
L'indirizzo dovrebbe funzionare senza accesso, quindi portare un segreto dentro l'URL, e chiunque
avesse quel link leggerebbe i suoi turni per sempre — senza scadenza, senza modo di accorgersene,
e senza che nessuna delle difese descritte in `2026-08-02-autenticazione-passkey-design.md` possa
farci niente. Un'app che si è chiusa col volto non apre una porta laterale sui dati che protegge.

**Non esporta le ore corrette a mano.** Vedi *Le ore corrette non entrano*, più sotto.

**Non aggiunge una rotta, una Lambda o una riga di infrastruttura.** Il browser ha già i turni del
mese in mano: mandarli a un server per riaverli indietro come testo sarebbe lavoro per niente.

## Dove sta

Un pulsante nella vista **Calendario**, accanto alla navigazione del mese. L'esportazione è di un
mese, e il mese è lì.

Si scarica **il mese che sta guardando**, non l'anno. È la forma in cui i turni arrivano davvero —
un mese alla volta, da una foto affissa in reparto — quindi un turno che cambia si riesporta da
solo, e non trascina con sé altri undici mesi.

## Cosa esce

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//vanessa.matteo.cool//turni//IT
METHOD:PUBLISH
X-WR-CALNAME:Turni di Vanessa
BEGIN:VEVENT
UID:turno-2026-08-13@vanessa.matteo.cool
DTSTAMP:20260813T101500Z
SEQUENCE:0
DTSTART:20260813T070000
DTEND:20260813T130000
SUMMARY:Mattina (M)
BEGIN:VALARM
TRIGGER:-PT12H
ACTION:DISPLAY
DESCRIPTION:Mattina (M)
END:VALARM
END:VEVENT
END:VCALENDAR
```

Gli orari escono da `SHIFTS` in `core/src/shifts.ts`, che li ha già: `M` 07:00–13:00, `M1`
07:00–14:00, `P` 13:00–20:00, `P1` 13:00–21:00. Non c'è niente da inventare e niente da tenere
allineato a mano.

La `DESCRIPTION` che si vede lì dentro sta **nel `VALARM`**, non nell'evento: `ACTION:DISPLAY` la
pretende, ed è il testo che compare nella notifica. La `DESCRIPTION` dell'evento resta assente —
vedi *Fuori perimetro*.

La firma è una sola, e prende la sequenza dall'esterno perché `core` non tocca `localStorage`:

```ts
export function icsDelMese(
  year: number,
  month: number,
  days: ReadonlyMap<IsoDate, DayEntry>,
  sequence: number,
  now: Date,
): string;
```

`now` è iniettato per lo stesso motivo per cui lo è `today` altrove: serve a `DTSTAMP`, e un test
che dipende dall'ora in cui gira non è un test.

### Orari fluttuanti, senza fuso

`DTSTART:20260813T070000` — senza `Z`, senza `TZID`, senza blocco `VTIMEZONE`.

RFC 5545 chiama questa forma *floating*: il dispositivo la legge nel proprio fuso. Le sette del
mattino restano le sette del mattino, senza nessuna conversione, quindi **senza aritmetica
sull'ora legale e senza un `VTIMEZONE` scritto a mano** — che è precisamente il pezzo che si
sbaglia in modo invisibile, e che si scopre rotto l'ultima domenica di marzo.

Il prezzo: su un telefono impostato su un altro fuso il turno si legge comunque alle 07:00 locali.
Per una persona che lavora sempre nello stesso reparto in Italia è la risposta giusta, non un
compromesso.

### `L` non diventa un evento

`Libero` non ha orario di inizio né di fine: potrebbe solo essere un evento di giornata intera, e
riempirebbe il mese di striscioni «Libero» sopra i giorni in cui non succede niente. I giorni
liberi si riconoscono dal fatto che non c'è scritto niente.

### Le ore corrette non entrano

Se un giorno vale 6 ore da contratto e ne ha fatte 4, l'app lo sa — ma sa che è cambiata la
**durata**, non **quale estremo** si è spostato: se sia entrata più tardi o uscita prima. Un
evento inventato su quel dato direbbe una cosa che nessuno ha scritto.

E le due domande sono diverse: il calendario risponde a *quando lavoro*, che è il turno; la
correzione risponde a *quanto ho lavorato*, che è il cartellino. Il file porta gli orari del
turno, e le due cose restano separate.

## Riesportare lo stesso mese

Ogni evento ha un **UID stabile**, costruito dalla data: `turno-2026-08-13@vanessa.matteo.cool`.
Esportare due volte lo stesso mese produce gli stessi identificatori, ed è questa la condizione
perché Calendario riconosca gli eventi invece di aggiungerli una seconda volta.

È la condizione **necessaria**. Non è detto che basti: il comportamento di iOS all'importazione
non è verificabile senza il suo telefono, e nei forum Apple c'è gente che si ritrova i doppioni
comunque.

Per dargli la miglior possibilità, `SEQUENCE` **cresce a ogni esportazione**, contato in
`localStorage` per mese e per dispositivo (`ics:2026-08` → 0, 1, 2…). È l'unico numero monotono
disponibile senza stato sul server, ed è quello che i client guardano per decidere che un evento è
una **versione più nuova** e non un evento nuovo.

Il contatore vive sul dispositivo, quindi da un telefono diverso riparte da zero. È accettato: la
riesportazione la fa dallo stesso telefono su cui importa.

**Se i doppioni arrivano lo stesso**, la via d'uscita è cancellare gli eventi di quel mese e
reimportare. Va scritto nel README, o si riscopre da capo fra sei mesi.

## La sveglia sta solo sui mattini

`TRIGGER:-PT12H`, e **solo su `M` e `M1`**.

Dodici ore prima di un turno che comincia alle 07:00 sono le 19:00 della sera prima: il momento in
cui sapere che domani si comincia presto serve ancora a qualcosa.

Le stesse dodici ore su un turno che comincia alle 13:00 sono **l'una di notte**. Una sveglia
all'una del mattino per avvisare di un turno del pomeriggio non è un fastidio minore: è il
roster che sveglia chi lavora. I turni di pomeriggio cominciano alle 13:00 e non hanno bisogno di
preavviso, quindi non hanno sveglia.

Una regola sola, con una condizione sola: la sveglia c'è se il turno comincia la mattina.

## Cosa vede Vanessa quando qualcosa non va

| Caso | Cosa succede |
|------|--------------|
| Mese senza turni lavorati | Il pulsante è disabilitato. Un file vuoto si importa senza errori e senza effetti: sembra che l'esportazione non abbia funzionato, e invece non c'era niente da esportare. **«Senza turni lavorati»** vuol dire zero eventi prodotti: un mese vuoto e un mese di soli `L` sono lo stesso caso, perché `L` non diventa un evento. |
| Turno cambiato dopo l'esportazione | Si riesporta lo stesso mese. Vedi sopra: UID stabili e `SEQUENCE` che cresce. |
| Doppioni dopo la reimportazione | Si cancellano gli eventi del mese e si reimporta. È nel README. |

## Il passo che solo il suo telefono può dire

Il file si costruisce e si scarica; **come arriva a Calendario su un iPhone è l'unica parte che
non si può provare da qui.**

L'implementazione usa un `Blob` con l'attributo `download`: su iOS il file finisce in *File*, e da
lì si apre in Calendario. Safari su iOS è stato incoerente su questo fra una versione e l'altra, e
l'alternativa — navigare verso un `data:text/calendar`, che iOS a volte passa direttamente a
Calendario — non è meglio in astratto, è solo diversa.

Si parte dal `Blob`. Se sul suo telefono non funziona, è quella riga che cambia, e non il resto.

## Cosa cambia nel codice

| Dove | Cosa |
|------|------|
| `core/src/ics.ts` (nuovo) | costruisce il testo del file: eventi, sveglie, UID, escape |
| `core/src/index.ts` | esporta `./ics.js` |
| `web/src/scarica.ts` (nuovo) | l'unica parte che tocca il DOM: `Blob`, ancora, click |
| `web/src/App.tsx` | il pulsante accanto alla navigazione del mese, e il contatore in `localStorage` |
| `app/README.md` | la vista, il formato, e cosa fare se arrivano i doppioni |

La divisione è quella che il repository ha già: `core` è logica pura e si prova senza un DOM,
`web` tocca il browser. `ics.ts` sta in `core` per la stessa ragione per cui ci sta `summary.ts` —
è una trasformazione dei dati di dominio, e tutto ciò che c'è da sbagliare (l'escape, gli UID, chi
prende la sveglia) si prova senza aprire una pagina.

### Niente piegatura delle righe

RFC 5545 vuole le righe piegate a 75 ottetti. Qui **non si implementa**, e non è una svista: la
riga più lunga che usciamo è `SUMMARY:Pomeriggio lungo (P1)`, ventinove caratteri. Codice
irraggiungibile è codice che nessun test può coprire, ed è peggio di codice assente.

Il commento sul punto dice cosa lo cambierebbe: mettere le note libere in `DESCRIPTION` — testo
scritto da lei, di lunghezza qualsiasi — richiederebbe la piegatura subito.

L'escape invece si fa, perché serve già: `\`, `;`, `,` e gli a capo dentro un valore di testo. E le
righe finiscono con CRLF, che lo standard pretende e che qualche parser applica sul serio.

## Test

| Pacchetto | Cosa si prova |
|-----------|---------------|
| `core` | `L` non produce eventi; la sveglia c'è su `M` e `M1` e non su `P` e `P1`; lo stesso mese esportato due volte dà gli stessi UID; `SEQUENCE` cresce quando glielo si passa; CRLF e escape; un mese senza turni lavorati non produce nessun `VEVENT` |
| `web` | il pulsante è disabilitato su un mese vuoto e scarica su un mese pieno; il contatore in `localStorage` cresce a ogni scaricamento |

Le due che contano davvero sono **gli UID identici fra due esportazioni** — è tutto ciò che
separa un aggiornamento da un doppione — e **la sveglia che non compare sui pomeriggi**, perché
sbagliarla significa una sveglia all'una di notte e nessun test verde lo direbbe.

## Fuori perimetro

Niente sottoscrizione `webcal:`, per la ragione in cima. Niente esportazione dell'anno intero.
Niente collega, tipo di scambio o note dentro l'evento — la `DESCRIPTION` resta vuota, ed è anche
ciò che tiene le righe corte. Niente importazione dal calendario verso l'app: il flusso va in una
direzione sola. Niente scelta del calendario di destinazione: la fa iOS quando importa.
