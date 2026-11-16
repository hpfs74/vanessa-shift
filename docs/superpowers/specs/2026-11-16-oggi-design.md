# Oggi: i prossimi cinque giorni, e chi c'è

Data: 16 novembre 2026
Stato: approvato — richiesta di procedere senza domande; le scelte sotto sono di Claude

## Perché

Aprendo l'app oggi si arriva sul calendario del mese: per sapere «domani che turno ho, e chi c'è
con me» bisogna trovare il giorno, toccarlo, leggere. La domanda che si fa davvero è più corta e
riguarda solo i prossimi giorni. Una schermata che la accoglie e risponde a quella, subito.

## Obiettivi

- Un saluto: «Ciao Vanessa» e la data di oggi, in italiano.
- I cinque giorni da oggi a oggi+4, uno per riga, ciascuno con il suo turno e chi lavora con lei.
- È la prima schermata dell'app.

## Fuori perimetro

- Nessuna modifica dei turni da qui: toccare un giorno non apre l'editor (il calendario c'è già).
- Nessuna notifica o promemoria fuori dall'app.
- Nessun dato nuovo: turni e turnari sono quelli già salvati.

## Approcci

**Una vista nuova nella barra, «Oggi» — scelto.** Prima della barra e vista iniziale. Riusa i
turni che `App` carica già per tutto l'anno e `rosterOnDay` per le colleghe.

**Un blocco in cima al calendario.** Scartato: il calendario carica il turnario di un mese solo,
mentre cinque giorni possono attraversarne due, e la schermata del mese ha già abbastanza dentro.

## Come

- `View` guadagna `'oggi'`, primo in `VIEWS` (etichetta «Oggi»), e diventa il valore di default di
  `initialView`. I test che oggi si aspettano il calendario all'apertura passano `initialView`.
- Un componente nuovo `web/src/Oggi.tsx`, con props `{ today: IsoDate; days: ReadonlyMap<IsoDate,
  RemoteShift>; api: Pick<Api, 'roster'> }`.
- I cinque giorni si calcolano in `core` con una funzione pura `nextDays(today, n)` (date ISO
  consecutive, attraverso fine mese e fine anno).
- Il turnario si carica per ogni mese toccato dai cinque giorni (uno o due), con `api.roster`, solo
  per i mesi dell'anno coperto dall'app (`YEAR`). Un turnario che non si carica vale «non letto».
- Per ogni giorno:
  - intestazione: «oggi» / «domani» / nome del giorno, e la data («martedì 17 novembre»);
  - il turno: sigla con il colore che ha già nel calendario (`t-<codice>`), descrizione e orari
    («Mattina · 07:00–13:00»); «Libero» per `L`; «Nessun turno inserito» se il giorno manca;
  - le colleghe, solo nei giorni in cui lavora: prima «Con te: …» (le `withYou` di
    `rosterOnDay`, con la loro sigla), poi «In reparto anche: …» per le altre presenti;
  - se il mese del giorno non ha turnario: «Le colleghe di <mese> non sono ancora state lette.»,
    una volta per mese e non ripetuto in ogni giorno.
- Testo in italiano; nessuna libreria nuova.

## Test

- `core`: `nextDays` attraverso fine mese e fine anno.
- `web` (`oggi.test.tsx`): il saluto e la data; cinque giorni nell'ordine giusto con «oggi» e
  «domani»; turno con orari; giorno senza turno; giorno libero senza colleghe; «Con te» separato da
  «In reparto anche»; due mesi → due chiamate a `roster`; mese senza turnario → la riga una volta.
- `app.test.tsx`: l'app apre su «Oggi».
