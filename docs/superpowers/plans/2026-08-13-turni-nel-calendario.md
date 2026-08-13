# I turni nel calendario dell'iPhone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un pulsante nella vista Calendario che scarica il mese come file `.ics`, da aprire in Calendario sull'iPhone.

**Architecture:** Il testo del file lo costruisce `core`, che è logica pura e si prova senza un DOM; `web` fa solo due cose che il browser pretende — il contatore in `localStorage` e lo scaricamento del `Blob`. Nessuna rotta, nessuna Lambda, nessuna modifica all'infrastruttura: i turni del mese sono già in memoria nel browser.

**Tech Stack:** TypeScript, Vitest, React 19 + Vite. Nessuna dipendenza nuova — il formato iCalendar si scrive a mano, sono venti righe.

Spec: `docs/superpowers/specs/2026-08-13-turni-nel-calendario-design.md`.

## Global Constraints

- **Commenti e descrizioni dei test in inglese.** Il testo che legge Vanessa — etichette, messaggi — in italiano.
- **Identificatori: inglesi in `core`, `api` e `infra`. In `web` l'italiano è ammesso**, perché è già la convenzione lì (`auth.ts` esporta `sessioneValida`, `vite.config.ts` ha `richiedeConfigAccesso`). Non rinominare quelli esistenti.
- I commenti spiegano **perché**, non cosa.
- `app/infra/**` e `.github/workflows/deploy.yml` **non si toccano in nessun task**.
- **Nessuna dipendenza npm nuova.**
- Le righe del file `.ics` finiscono con **CRLF**, che lo standard pretende.
- **Niente piegatura delle righe a 75 ottetti**, deliberatamente: la riga più lunga prodotta è `SUMMARY:Pomeriggio lungo (P1)`, ventinove caratteri. Codice irraggiungibile è codice che nessun test copre.
- I comandi si lanciano dalla cartella `app/`.
- Test mirato: `npx vitest run --root <pkg> <pkg>/test/<file>`. Suite intera: `npm test`.
- **Prima di ogni commit: `npm test` E `npm run typecheck`.** `npm test` non fa typecheck — vitest toglie i tipi — quindi da solo non vede un'interfaccia allargata che rompe un finto oggetto scritto a mano.
- Commit in italiano, nella forma già in uso (`feat:`, `fix:`, `test:`, `docs:`).

## File Structure

| File | Responsabilità |
|------|----------------|
| `core/src/ics.ts` (nuovo) | costruisce il testo del file: quali giorni diventano eventi, gli UID, le sveglie, l'escape |
| `core/src/index.ts` | esporta `./ics.js` |
| `web/src/esportaTurni.ts` (nuovo) | le due cose che solo il browser sa fare: il contatore in `localStorage` e lo scaricamento del `Blob` |
| `web/src/App.tsx` | il pulsante nella vista Calendario |
| `app/README.md` | la vista, il formato, e cosa fare se arrivano i doppioni |

**Perché due file e non uno.** `ics.ts` non tocca né `localStorage` né il DOM, ed è dove sta tutto quello che c'è da sbagliare: si prova con `expect` su una stringa, senza jsdom. `esportaTurni.ts` è il contrario — è solo effetti collaterali del browser — e sta separato perché è la parte che, se sull'iPhone non funziona, si riscrive senza toccare la logica.

---

### Task 1: Il file `.ics`

**Files:**
- Create: `app/core/src/ics.ts`
- Modify: `app/core/src/index.ts`
- Test: `app/core/test/ics.test.ts`

**Interfaces:**
- Consumes: `DayEntry`, `shift`, `SHIFTS` da `./shifts.js`; `IsoDate`, `monthDays` da `./dates.js`
- Produces:
  - `icsDelMese(year: number, month: number, days: ReadonlyMap<IsoDate, DayEntry>, sequence: number, now: Date): string`
  - `contaTurniEsportabili(year: number, month: number, days: ReadonlyMap<IsoDate, DayEntry>): number`

- [ ] **Step 1: Write the failing test**

Create `app/core/test/ics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { DayEntry, IsoDate } from '../src/index.js';
import { contaTurniEsportabili, icsDelMese } from '../src/index.js';

/** A fixed instant, so DTSTAMP is the same on every run. A test that depends
 *  on the clock it runs at is not a test. */
const ORA = new Date('2026-08-13T10:15:00.000Z');

const mese = (giorni: Record<string, DayEntry>): ReadonlyMap<IsoDate, DayEntry> =>
  new Map(Object.entries(giorni) as [IsoDate, DayEntry][]);

describe('icsDelMese', () => {
  it('wraps the events in a calendar', () => {
    const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), 0, ORA);
    expect(out.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(out).toContain('VERSION:2.0');
  });

  it('ends every line with CRLF, which the standard requires', () => {
    // A lone \n is the kind of thing a lenient parser forgives and a strict
    // one rejects, and the strict one is the phone.
    const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), 0, ORA);
    expect(out).not.toMatch(/[^\r]\n/);
  });

  it('turns a morning into a timed event with the shift hours', () => {
    const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), 0, ORA);
    expect(out).toContain('DTSTART:20260813T070000');
    expect(out).toContain('DTEND:20260813T130000');
    expect(out).toContain('SUMMARY:Mattina (M)');
  });

  it('writes times with no Z and no TZID, so the phone reads them locally', () => {
    // Floating time: no conversion, therefore no daylight-saving arithmetic
    // and no hand-written VTIMEZONE to get subtly wrong.
    const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), 0, ORA);
    expect(out).toMatch(/DTSTART:\d{8}T\d{6}\r\n/);
    expect(out).not.toContain('TZID');
    expect(out).not.toContain('VTIMEZONE');
  });

  it('stamps every event with the instant it was built', () => {
    const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), 0, ORA);
    expect(out).toContain('DTSTAMP:20260813T101500Z');
  });

  it('skips Libero, which has no hours to put on a clock', () => {
    const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code: 'L' } }), 0, ORA);
    expect(out).not.toContain('BEGIN:VEVENT');
  });

  it('gives the same day the same UID every time it is exported', () => {
    // This is the whole of what separates an update from a duplicate.
    const giorni = mese({ '2026-08-13': { code: 'M' } });
    const primo = icsDelMese(2026, 8, giorni, 0, ORA);
    const secondo = icsDelMese(2026, 8, giorni, 1, new Date('2026-09-01T08:00:00.000Z'));
    expect(primo).toContain('UID:turno-2026-08-13@vanessa.matteo.cool');
    expect(secondo).toContain('UID:turno-2026-08-13@vanessa.matteo.cool');
  });

  it('carries the sequence it was given', () => {
    const giorni = mese({ '2026-08-13': { code: 'M' } });
    expect(icsDelMese(2026, 8, giorni, 0, ORA)).toContain('SEQUENCE:0');
    expect(icsDelMese(2026, 8, giorni, 3, ORA)).toContain('SEQUENCE:3');
  });

  it('puts the alarm on the shifts that start in the morning', () => {
    for (const code of ['M', 'M1'] as const) {
      const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code } }), 0, ORA);
      expect(out, code).toContain('BEGIN:VALARM');
      expect(out, code).toContain('TRIGGER:-PT12H');
    }
  });

  it('leaves the afternoons without one, or it would ring at one in the morning', () => {
    // Twelve hours before a 13:00 start is 01:00. An alarm that wakes a shift
    // worker to tell her about an afternoon shift is worse than no alarm.
    for (const code of ['P', 'P1'] as const) {
      const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code } }), 0, ORA);
      expect(out, code).not.toContain('BEGIN:VALARM');
    }
  });

  it('produces no events for a month with nothing worked in it', () => {
    expect(icsDelMese(2026, 8, mese({}), 0, ORA)).not.toContain('BEGIN:VEVENT');
    expect(icsDelMese(2026, 8, mese({ '2026-08-13': { code: 'L' } }), 0, ORA)).not.toContain(
      'BEGIN:VEVENT',
    );
  });

  it('only exports the month it was asked for', () => {
    const out = icsDelMese(
      2026,
      8,
      mese({ '2026-07-31': { code: 'M' }, '2026-08-01': { code: 'M' }, '2026-09-01': { code: 'M' } }),
      0,
      ORA,
    );
    expect(out).toContain('UID:turno-2026-08-01@');
    expect(out).not.toContain('UID:turno-2026-07-31@');
    expect(out).not.toContain('UID:turno-2026-09-01@');
  });

  it('puts the days in order', () => {
    const out = icsDelMese(
      2026,
      8,
      mese({ '2026-08-20': { code: 'M' }, '2026-08-03': { code: 'P' } }),
      0,
      ORA,
    );
    expect(out.indexOf('turno-2026-08-03')).toBeLessThan(out.indexOf('turno-2026-08-20'));
  });

  it('ignores an hours override, which says how long and not which end moved', () => {
    // The calendar answers "when am I working". The override answers "what
    // did I actually do", and the two are different questions.
    const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code: 'M', hoursOverride: 4 } }), 0, ORA);
    expect(out).toContain('DTSTART:20260813T070000');
    expect(out).toContain('DTEND:20260813T130000');
  });
});

describe('contaTurniEsportabili', () => {
  it('counts the days that will become events', () => {
    expect(
      contaTurniEsportabili(
        2026,
        8,
        mese({ '2026-08-03': { code: 'M' }, '2026-08-04': { code: 'L' }, '2026-08-05': { code: 'P' } }),
      ),
    ).toBe(2);
  });

  it('is zero for a month of Libero, exactly as for an empty one', () => {
    expect(contaTurniEsportabili(2026, 8, mese({ '2026-08-04': { code: 'L' } }))).toBe(0);
    expect(contaTurniEsportabili(2026, 8, mese({}))).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root core core/test/ics.test.ts`
Expected: FAIL — `icsDelMese` is not exported from `../src/index.js`.

- [ ] **Step 3: Write minimal implementation**

Create `app/core/src/ics.ts`:

```ts
/** The month as an iCalendar file, for Calendar on the iPhone.
 *
 *  Everything that can go wrong lives here — which days become events, what
 *  identifies them, who gets an alarm, how text is escaped — and none of it
 *  touches the browser, so all of it is provable with `expect` on a string.
 */

import { type DayEntry, type Shift, shift } from './shifts.js';
import { type IsoDate, monthDays } from './dates.js';

/** Half of every UID, so changing it makes every event she already imported
 *  look like a different event. It is not the login domain and does not need
 *  to be: a UID is an identifier, not an address. */
const DOMINIO = 'vanessa.matteo.cool';

/** Not exported: nothing outside this file needs it, and an export nobody
 *  imports is a promise nobody asked for. */
const NOME_CALENDARIO = 'Turni di Vanessa';

/** RFC 5545 escaping for a TEXT value. The backslash goes first, or it would
 *  escape the escapes added after it. */
function testo(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** `2026-08-13` + `07:00` -> `20260813T070000`, with no zone: see the spec. */
function dataOra(d: IsoDate, hhmm: string): string {
  return `${d.replace(/-/g, '')}T${hhmm.replace(':', '')}00`;
}

/** `DTSTAMP` is the one field that is a real instant, so it is the one field
 *  in UTC. */
function istante(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
}

/** The alarm goes on the shifts that start in the morning, and only those.
 *  Twelve hours before a 07:00 start is 19:00 the evening before, which is
 *  when knowing about it still helps. Twelve hours before a 13:00 start is
 *  01:00, which is a roster waking up the person who works it. */
function iniziaLaMattina(s: Shift): boolean {
  // Zero-padded HH:MM compares correctly as a string.
  return s.start !== '' && s.start < '12:00';
}

/** The days of that month that become events, in order. Libero is not one of
 *  them: with no start and no end it could only be an all-day banner over a
 *  day on which nothing happens. */
function turniDelMese(
  year: number,
  month: number,
  days: ReadonlyMap<IsoDate, DayEntry>,
): { date: IsoDate; s: Shift }[] {
  const out: { date: IsoDate; s: Shift }[] = [];
  for (const date of monthDays(year, month)) {
    const e = days.get(date);
    if (!e) continue;
    const s = shift(e.code);
    if (!s.start || !s.end) continue;
    out.push({ date, s });
  }
  return out;
}

export function contaTurniEsportabili(
  year: number,
  month: number,
  days: ReadonlyMap<IsoDate, DayEntry>,
): number {
  return turniDelMese(year, month, days).length;
}

/** `sequence` and `now` come from outside because `core` reads neither the
 *  clock nor `localStorage`: the counter lives in the browser, and a test
 *  that depends on the time it runs at is not a test. */
export function icsDelMese(
  year: number,
  month: number,
  days: ReadonlyMap<IsoDate, DayEntry>,
  sequence: number,
  now: Date,
): string {
  const stamp = istante(now);
  const righe: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${DOMINIO}//turni//IT`,
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${testo(NOME_CALENDARIO)}`,
  ];

  for (const { date, s } of turniDelMese(year, month, days)) {
    const titolo = `${s.description} (${s.code})`;
    righe.push(
      'BEGIN:VEVENT',
      // Built from the date alone, so the same day exported twice keeps the
      // same identity and Calendar can update it instead of adding a second.
      `UID:turno-${date}@${DOMINIO}`,
      `DTSTAMP:${stamp}`,
      `SEQUENCE:${sequence}`,
      `DTSTART:${dataOra(date, s.start)}`,
      `DTEND:${dataOra(date, s.end)}`,
      `SUMMARY:${testo(titolo)}`,
    );
    if (iniziaLaMattina(s)) {
      righe.push(
        'BEGIN:VALARM',
        'TRIGGER:-PT12H',
        'ACTION:DISPLAY',
        // Required by ACTION:DISPLAY, and it is the text of the notification.
        // This is the alarm's DESCRIPTION, not the event's, which stays absent.
        `DESCRIPTION:${testo(titolo)}`,
        'END:VALARM',
      );
    }
    righe.push('END:VEVENT');
  }

  righe.push('END:VCALENDAR');
  // CRLF, and a trailing one: the standard asks for it and strict parsers
  // enforce it. No 75-octet folding — the longest line we emit is
  // `SUMMARY:Pomeriggio lungo (P1)`. Putting free text in a DESCRIPTION on
  // the event would need folding immediately.
  return righe.join('\r\n') + '\r\n';
}
```

Modify `app/core/src/index.ts` — add beside the others:

```ts
export * from './ics.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root core core/test/ics.test.ts`
Expected: PASS — 16 tests.

- [ ] **Step 5: Run the whole suite and typecheck, then commit**

Run: `npm test && npm run typecheck`

```bash
git add core/src/ics.ts core/src/index.ts core/test/ics.test.ts
git commit -m "feat: il mese diventa un file per il calendario"
```

---

### Task 2: Il contatore e lo scaricamento

**Files:**
- Create: `app/web/src/esportaTurni.ts`
- Test: `app/web/test/esportaTurni.test.ts`

**Interfaces:**
- Consumes: `icsDelMese`, `contaTurniEsportabili` da `@vanessa/core` (Task 1); `DayEntry`, `IsoDate` da `@vanessa/core`
- Produces: `esportaMese(year: number, month: number, days: ReadonlyMap<IsoDate, DayEntry>, now?: Date): void`

- [ ] **Step 1: Write the failing test**

Create `app/web/test/esportaTurni.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DayEntry, IsoDate } from '@vanessa/core';

import { esportaMese } from '../src/esportaTurni.js';

const ORA = new Date('2026-08-13T10:15:00.000Z');

const mese = (giorni: Record<string, DayEntry>): ReadonlyMap<IsoDate, DayEntry> =>
  new Map(Object.entries(giorni) as [IsoDate, DayEntry][]);

/** jsdom has no object URLs and does not navigate, so the two browser calls
 *  are stubbed and inspected. What is being tested is what we hand the
 *  browser, which is the only part we control. */
function browserFinto() {
  const creati: Blob[] = [];
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (b: Blob) => {
      creati.push(b);
      return 'blob:finto';
    },
    revokeObjectURL: () => {},
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  return { creati, click };
}

describe('esportaMese', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hands the browser a calendar file named for the month', async () => {
    const { creati, click } = browserFinto();
    esportaMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), ORA);

    expect(click).toHaveBeenCalledOnce();
    expect(creati).toHaveLength(1);
    expect(creati[0]!.type).toContain('text/calendar');
    expect(await creati[0]!.text()).toContain('UID:turno-2026-08-13@');
  });

  it('names the file after the month, so two months do not collide', () => {
    browserFinto();
    const a = document.createElement('a');
    const creaElemento = vi.spyOn(document, 'createElement').mockReturnValue(a);
    esportaMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), ORA);
    creaElemento.mockRestore();
    expect(a.download).toBe('turni-2026-08.ics');
  });

  it('starts the sequence at zero and raises it on every export', async () => {
    // The one monotonic number available without a server, and what a client
    // uses to tell a newer version of an event from a new event.
    const { creati } = browserFinto();
    const giorni = mese({ '2026-08-13': { code: 'M' } });

    esportaMese(2026, 8, giorni, ORA);
    esportaMese(2026, 8, giorni, ORA);

    expect(await creati[0]!.text()).toContain('SEQUENCE:0');
    expect(await creati[1]!.text()).toContain('SEQUENCE:1');
  });

  it('counts each month separately', async () => {
    const { creati } = browserFinto();
    esportaMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), ORA);
    esportaMese(2026, 9, mese({ '2026-09-10': { code: 'M' } }), ORA);
    expect(await creati[1]!.text()).toContain('SEQUENCE:0');
  });

  it('survives a counter that something else scribbled on', async () => {
    // localStorage is a string store: whatever is in there might not be a
    // number, and starting over at zero beats crashing the export.
    localStorage.setItem('ics:2026-08', 'non-un-numero');
    const { creati } = browserFinto();
    esportaMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), ORA);
    expect(await creati[0]!.text()).toContain('SEQUENCE:0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root web web/test/esportaTurni.test.ts`
Expected: FAIL — cannot resolve `../src/esportaTurni.js`.

- [ ] **Step 3: Write minimal implementation**

Create `app/web/src/esportaTurni.ts`:

```ts
/** Getting the month onto the phone.
 *
 *  The two things `core` cannot do: the counter, which lives in this browser,
 *  and the download itself. Kept apart from `ics.ts` on purpose — this is the
 *  half that only a real iPhone can confirm, and if it turns out to need a
 *  different route to Calendar, nothing about the file has to change.
 */

import type { DayEntry, IsoDate } from '@vanessa/core';
import { icsDelMese } from '@vanessa/core';

const PREFISSO = 'ics:';

/** `SEQUENCE` has to grow for a client to read an event as a newer version of
 *  one it already has, rather than as a new one. There is no server state
 *  here, so the count lives per month in this browser: from another phone it
 *  starts at zero again, which is fine because the re-import happens on the
 *  phone that exported. */
function prossimaSequenza(chiave: string): number {
  const grezzo = localStorage.getItem(chiave);
  const n = Number(grezzo);
  // Anything that is not a whole number — absent, junk, someone else's write —
  // starts over rather than failing the export.
  const corrente = Number.isInteger(n) && n >= 0 ? n : 0;
  localStorage.setItem(chiave, String(corrente + 1));
  return corrente;
}

export function esportaMese(
  year: number,
  month: number,
  days: ReadonlyMap<IsoDate, DayEntry>,
  now: Date = new Date(),
): void {
  const mese = String(month).padStart(2, '0');
  const sequenza = prossimaSequenza(`${PREFISSO}${year}-${mese}`);
  const testo = icsDelMese(year, month, days, sequenza, now);

  const blob = new Blob([testo], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `turni-${year}-${mese}.ics`;
  a.click();
  // Revoked on the next tick, not now: revoking synchronously can pull the
  // blob out from under a download that has not started reading it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root web web/test/esportaTurni.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Run the whole suite and typecheck, then commit**

Run: `npm test && npm run typecheck`

```bash
git add web/src/esportaTurni.ts web/test/esportaTurni.test.ts
git commit -m "feat: il file si scarica, e la sequenza cresce a ogni giro"
```

---

### Task 3: Il pulsante

**Files:**
- Modify: `app/web/src/App.tsx`
- Modify: `app/web/src/styles.css`
- Test: `app/web/test/app.test.tsx`

**Interfaces:**
- Consumes: `esportaMese` (Task 2); `contaTurniEsportabili` da `@vanessa/core` (Task 1)
- Produces: nothing for later tasks

- [ ] **Step 1: Write the failing test**

Add to `app/web/test/app.test.tsx`. The file already has `fakeApi(initial: RemoteShift[] = [], …)`, which seeds the month through its first argument and returns an object whose `.api` goes to `<App>`; and `const JAN = '2026-01-15'`. Use both as they are — there is no `renderApp()` helper in this file.

```tsx
describe('esportazione nel calendario', () => {
  it('offers the export on a month with shifts in it', async () => {
    const f = fakeApi([{ date: '2026-01-05', code: 'M' }]);
    render(<App api={f.api} today={JAN} />);
    expect(await screen.findByRole('button', { name: 'Esporta nel calendario' })).toBeEnabled();
  });

  it('disables it on a month with nothing to export', async () => {
    // An empty file imports with no error and no effect, which looks exactly
    // like a broken export. Better to say there is nothing to send.
    render(<App api={fakeApi().api} today={JAN} />);
    expect(await screen.findByRole('button', { name: 'Esporta nel calendario' })).toBeDisabled();
  });

  it('treats a month of Libero as nothing to export', async () => {
    // `L` has no hours, so it produces no event: a month of Libero and an
    // empty month are the same case.
    const f = fakeApi([{ date: '2026-01-05', code: 'L' }]);
    render(<App api={f.api} today={JAN} />);
    expect(await screen.findByRole('button', { name: 'Esporta nel calendario' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root web web/test/app.test.tsx`
Expected: FAIL — no button named `Esporta nel calendario`.

- [ ] **Step 3: Write minimal implementation**

In `app/web/src/App.tsx`:

Extend the `@vanessa/core` import with `contaTurniEsportabili`, and add:

```ts
import { esportaMese } from './esportaTurni.js';
```

Just below the existing `entries` memo, add:

```ts
  // Libero produces no event, so a month of Libero and an empty month are the
  // same case: nothing to send.
  const daEsportare = useMemo(
    () => contaTurniEsportabili(YEAR, month, entries),
    [month, entries],
  );
```

In the calendar view, immediately after the closing tag of the `<div className="month-nav">` block, add:

```tsx
              <button
                type="button"
                className="esporta"
                disabled={daEsportare === 0}
                onClick={() => esportaMese(YEAR, month, entries)}
              >
                Esporta nel calendario
              </button>
```

In `app/web/src/styles.css`, add — following the file's existing conventions for spacing and the 44px touch target:

```css
.esporta {
  width: 100%;
  min-height: 44px;
  margin: 0.5rem 0;
}
```

If a rule for `button` already sets a min-height at or above 44px, do not repeat it here; keep only what this button adds.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root web web/test/app.test.tsx`
Expected: PASS — the file's existing tests plus 3 new ones, with no existing test modified.

- [ ] **Step 5: Run the whole suite and typecheck, then commit**

Run: `npm test && npm run typecheck`

```bash
git add web/src/App.tsx web/src/styles.css web/test/app.test.tsx
git commit -m "feat: il mese si esporta dal calendario, e non quando non c'e' niente"
```

---

### Task 4: La documentazione

**Files:**
- Modify: `app/README.md`

**Interfaces:**
- Consumes: everything above
- Produces: nothing

- [ ] **Step 1: Add the row to the views table**

In `app/README.md`, in the **Viste** table, extend the **Calendario** row's description so it ends with:

```
Da qui si esporta il mese nel calendario del telefono.
```

Keep the row on one line, with the same two-column shape as its neighbours.

- [ ] **Step 2: Add the section**

Add a new section immediately **before** `## Colori dei grafici`:

```markdown
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

### Se dopo aver riesportato compaiono i doppioni

Ogni evento ha un identificatore costruito dalla data — `turno-2026-08-13@vanessa.matteo.cool` —
che non cambia fra un'esportazione e l'altra, ed è la condizione perché Calendario aggiorni gli
eventi invece di aggiungerli una seconda volta. In più `SEQUENCE` cresce a ogni esportazione, ed è
il numero che i client guardano per capire che un evento è una versione più nuova. Il contatore sta
in `localStorage`, per mese e per dispositivo.

È la condizione necessaria, non la garanzia: come iOS si comporta all'importazione non è
verificabile senza il telefono. **Se i doppioni arrivano lo stesso**, si cancellano gli eventi di
quel mese dal calendario e si reimporta il file. Non c'è niente da sistemare nell'app.

### Quello che non fa

Non è un calendario sottoscritto che si aggiorna da solo. Una sottoscrizione di iOS non sa
autenticarsi — niente OAuth, niente passkey, niente header — quindi l'indirizzo dovrebbe funzionare
senza accesso e portare un segreto nell'URL, e chiunque avesse quel link leggerebbe i turni per
sempre. Un'app che si è chiusa col volto non apre una porta laterale sui dati che protegge. Il
ragionamento per esteso sta in `docs/superpowers/specs/2026-08-13-turni-nel-calendario-design.md`.

Non esporta le ore corrette a mano: l'app sa che la **durata** è cambiata, non **quale estremo** si
è spostato. Il calendario porta gli orari del turno, la correzione resta nel cartellino.
```

- [ ] **Step 3: Verify nothing else broke**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass. A README edit cannot affect them; if one fails, report it rather than fixing it, because it means something else is wrong.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: come i turni finiscono nel calendario del telefono"
```

---

## Self-Review

**Spec coverage:**

| Sezione della spec | Task |
|--------------------|------|
| Pulsante nella vista Calendario, un mese alla volta | 3 |
| Formato del file, `X-WR-CALNAME`, `PRODID` | 1 |
| Orari fluttuanti, niente `VTIMEZONE` | 1 (test + implementazione) |
| `L` non diventa un evento | 1 |
| Le ore corrette non entrano | 1 (test dedicato) |
| UID stabili | 1 |
| `SEQUENCE` che cresce, contatore in `localStorage` | 2 |
| Sveglia solo sui mattini | 1 |
| Pulsante spento su un mese senza turni | 1 (`contaTurniEsportabili`) + 3 (il pulsante) |
| CRLF ed escape, niente piegatura | 1 |
| Scaricamento via `Blob` | 2 |
| README: formato, doppioni, cosa non fa | 4 |

**Non coperto di proposito:** `app/infra/**` e `deploy.yml`, che la spec dichiara intoccati; la
sottoscrizione `webcal:`, fuori perimetro.
