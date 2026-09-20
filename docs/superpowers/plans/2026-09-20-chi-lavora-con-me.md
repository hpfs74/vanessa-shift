# Chi lavora con me — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'import legge tutte le righe del foglio, non solo quella di Vanessa, e il calendario mostra chi è in turno lo stesso giorno — segnalando chi si sovrappone davvero alle sue ore.

**Architecture:** Tutta la logica che si può sbagliare sta in `core/src/roster.ts`, che è puro e si prova senza rete e senza DOM: validazione best-effort, sovrapposizione degli orari, rimodellamento quando cambia il mese. `api` aggiunge due metodi al repo e due rotte; `infra` due Lambda; `web` una prop al calendario, un blocco richiudibile nell'import e un blocco in sola lettura nel foglio del giorno. La riga di Vanessa non cambia di una virgola in nessun task.

**Tech Stack:** TypeScript, Vitest, React 19 + Vite, AWS CDK, DynamoDB, Bedrock. Nessuna dipendenza nuova.

Spec: `docs/superpowers/specs/2026-09-20-chi-lavora-con-me-design.md`.

## Global Constraints

- **Commenti e descrizioni dei test in inglese.** Il testo che legge Vanessa — etichette, messaggi — in italiano.
- **Identificatori: inglesi in `core`, `api` e `infra`. In `web` l'italiano è ammesso**, perché è già la convenzione lì. Non rinominare quelli esistenti.
- I commenti spiegano **perché**, non cosa.
- **Nessuna dipendenza npm nuova.**
- `MAX_TOKENS` in `api/src/vision.ts` diventa esattamente **16000**.
- `MAX_READINGS_PER_DAY` **resta 10**. Nessun task lo tocca.
- `MAX_CODE_LENGTH = 4`, `MAX_ROSTER_PEOPLE = 60`.
- Le sigle si uniscono con la virgola per lo storage, quindi **una sigla non può contenere una virgola**: `normaliseCode` tiene solo `A-Z0-9`.
- **`validateReading` non si tocca in nessun task.** Se un task sembra chiederlo, il task è sbagliato.
- A differenza del piano `2026-08-13`, qui **`app/infra/**` si tocca** (Task 7). `.github/workflows/deploy.yml` no.
- I comandi si lanciano dalla cartella `app/`.
- Test mirato: `npx vitest run --root <pkg> <pkg>/test/<file>`. Suite intera: `npm test`.
- **Prima di ogni commit: `npm test` E `npm run typecheck`.** `npm test` non fa typecheck — vitest toglie i tipi — quindi da solo non vede un'interfaccia allargata che rompe un finto oggetto scritto a mano.
- Commit in italiano, nella forma già in uso (`feat:`, `fix:`, `test:`, `docs:`).

## File Structure

| File | Responsabilità |
|------|----------------|
| `core/src/roster.ts` (nuovo) | tipi, validazione best-effort, sovrapposizione oraria, rimodellamento sul mese |
| `core/src/index.ts` | esporta `./roster.js` |
| `api/src/repo.ts` | `readRoster` / `saveRoster`: l'unico posto che sa la forma della tabella, join e split compresi |
| `api/src/vision.ts` | prompt, schema, tetto dei token |
| `api/src/http.ts` | `requireYearMonth`, `requireRosterPeople` |
| `api/src/handlers.ts` | il roster nella risposta della foto; `getRoster` / `putRoster` |
| `infra/lib/app-stack.ts` | due Lambda, due rotte |
| `web/src/api.ts` | `readPhoto` restituisce due cose; `roster` / `saveRoster` |
| `web/src/PhotoImport.tsx` | il blocco richiudibile, il rimodellamento sul mese, l'ordine di salvataggio |
| `web/src/Calendar.tsx` | il conteggio nella cella |
| `web/src/DayEditor.tsx` | *Con te* / *Quel giorno*, in sola lettura |
| `web/src/App.tsx` | carica il roster al cambio mese e lo passa in giù |
| `app/README.md` | cosa viene conservato, e cosa succede se una riga è letta male |

**Perché `roster.ts` e non dentro `photo.ts`.** `photo.ts` esiste per enunciare una regola — *«validation is therefore all-or-nothing»* — e qui vale la regola opposta. Metterle nello stesso file trasformerebbe quel commento in una bugia per il prossimo che lo legge.

---

### Task 1: `core/src/roster.ts` — tipi e validazione best-effort

**Files:**
- Create: `app/core/src/roster.ts`
- Modify: `app/core/src/index.ts`
- Test: `app/core/test/roster.test.ts` (nuovo)

**Interfaces:**
- Consumes: `daysInMonth`, `parseIso`, `IsoDate` da `./dates.js`; `ROW_NAME` da `./photo.js`; `normaliseColleague` da `./swaps.js`.
- Produces: `RosterPerson`, `MonthRoster`, `MAX_CODE_LENGTH`, `normaliseCode(v: unknown): string`, `validateRoster(v: unknown, year: number, month: number): MonthRoster`.

- [ ] **Step 1: Write the failing test**

```ts
// app/core/test/roster.test.ts
import { describe, expect, it } from 'vitest';

import { normaliseCode, validateRoster } from '../src/index.js';

/** A well-formed `others` payload: one person, every day empty. */
function person(name: string, codes: string[], row: number | null = 3) {
  return { name, row, codes };
}

describe('normaliseCode', () => {
  it('uppercases and trims', () => {
    expect(normaliseCode(' m1 ')).toBe('M1');
  });

  it('keeps only letters and digits, so a code can never hold the separator', () => {
    expect(normaliseCode('M,')).toBe('M');
    expect(normaliseCode('P/1')).toBe('P1');
  });

  it('caps the length, so a model that wanders cannot store a sentence', () => {
    expect(normaliseCode('MATTINALUNGA')).toBe('MATT');
  });

  it('answers with an empty string for anything that is not one', () => {
    expect(normaliseCode(null)).toBe('');
    expect(normaliseCode(42)).toBe('');
  });
});

describe('validateRoster', () => {
  it('keeps a well-formed person', () => {
    const r = validateRoster(
      { others: [person('Giulia', Array(30).fill('M'))] },
      2026,
      9,
    );
    expect(r.people).toHaveLength(1);
    expect(r.people[0]!.name).toBe('Giulia');
    expect(r.people[0]!.codes).toHaveLength(30);
  });

  it('drops the malformed and keeps the rest: a bad row costs that row alone', () => {
    const r = validateRoster(
      {
        others: [
          person('Giulia', Array(30).fill('M')),
          person('Anna', Array(12).fill('P')), // wrong length for September
          person('', Array(30).fill('M')),
          'not an object',
          person('Marta', Array(30).fill('P1')),
        ],
      },
      2026,
      9,
    );
    expect(r.people.map((p) => p.name)).toEqual(['Giulia', 'Marta']);
  });

  it('never lets Vanessa in: her row already travels in the reading', () => {
    const r = validateRoster(
      { others: [person('  vanessa  ', Array(30).fill('M'))] },
      2026,
      9,
    );
    expect(r.people).toEqual([]);
  });

  it('keeps two people who normalise to the same name: on the sheet they are two rows', () => {
    const r = validateRoster(
      { others: [person('Giulia', Array(30).fill('M'), 3), person('Giulia', Array(30).fill('P'), 9)] },
      2026,
      9,
    );
    expect(r.people).toHaveLength(2);
    expect(r.people.map((p) => p.row)).toEqual([3, 9]);
  });

  it('survives a payload with no others at all', () => {
    expect(validateRoster({}, 2026, 9).people).toEqual([]);
    expect(validateRoster(null, 2026, 9).people).toEqual([]);
    expect(validateRoster({ others: 'nope' }, 2026, 9).people).toEqual([]);
  });

  it('carries the month it was told, not one of its own', () => {
    const r = validateRoster({ others: [] }, 2026, 9);
    expect(r).toMatchObject({ year: 2026, month: 9 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root core core/test/roster.test.ts`
Expected: FAIL — `normaliseCode` and `validateRoster` are not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/core/src/roster.ts
/** The other people on the sheet: who is in the ward on the same day.
 *
 * The rule here is deliberately the opposite of `photo.ts`. There a
 * half-plausible grid is worse than an error, because it is saved as her own
 * hours. Here a row belongs to somebody else and nothing computes with it, so
 * a row read badly must cost that row — never the import.
 */

import { daysInMonth } from './dates.js';
import { ROW_NAME } from './photo.js';
import { normaliseColleague } from './swaps.js';

/** Longer than this is not a code. The cap is what stops a model that wanders
 *  from storing a sentence inside a cell. */
export const MAX_CODE_LENGTH = 4;

export interface RosterPerson {
  readonly name: string;
  /** The row number when the sheet shows one. A caption: nothing computes. */
  readonly row: number | null;
  /** One entry per day of the month; '' means no shift in that cell. */
  readonly codes: readonly string[];
}

export interface MonthRoster {
  readonly year: number;
  readonly month: number;
  readonly people: readonly RosterPerson[];
}

/** Letters and digits only. Codes are joined with a comma for storage, so a
 *  comma surviving inside one would split a person's month in the wrong
 *  place — silently, and a month later. */
export function normaliseCode(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MAX_CODE_LENGTH);
}

function personOf(v: unknown, expected: number): RosterPerson | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const e = v as Record<string, unknown>;

  if (typeof e.name !== 'string') return null;
  const name = normaliseColleague(e.name);
  if (!name) return null;
  // Her row already travels in the `reading`. Twice over would put her on
  // shift with herself.
  if (name.toLocaleLowerCase('it') === ROW_NAME.toLocaleLowerCase('it')) return null;

  // The all-or-nothing rule does not disappear, it drops a level: from the
  // reading to the single row. A row that is not the length of the month was
  // not read against the day-number header, so none of it can be trusted.
  if (!Array.isArray(e.codes) || e.codes.length !== expected) return null;

  const row = typeof e.row === 'number' && Number.isInteger(e.row) ? e.row : null;
  return { name, row, codes: e.codes.map(normaliseCode) };
}

/** Best-effort by design: it drops what it cannot use and never throws.
 *  The caller has already validated Vanessa's own row, and nothing here may
 *  take that reading down. */
export function validateRoster(v: unknown, year: number, month: number): MonthRoster {
  const expected = daysInMonth(year, month);
  const people: RosterPerson[] = [];
  const raw =
    typeof v === 'object' && v !== null ? (v as Record<string, unknown>).others : undefined;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const p = personOf(item, expected);
      if (p) people.push(p);
    }
  }
  return { year, month, people };
}
```

E in `app/core/src/index.ts`, dopo la riga `export * from './photo.js';`:

```ts
export * from './roster.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root core core/test/roster.test.ts`
Expected: PASS, 10 test.

- [ ] **Step 5: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: verde. `index.ts` ha una riga in più e `photo.ts` non è cambiato.

- [ ] **Step 6: Commit**

```bash
git add app/core/src/roster.ts app/core/src/index.ts app/core/test/roster.test.ts
git commit -m "feat: le righe degli altri si validano una per una, non tutte insieme"
```

---

### Task 2: la sovrapposizione degli orari

**Files:**
- Modify: `app/core/src/roster.ts`
- Test: `app/core/test/roster.test.ts`

**Interfaces:**
- Consumes: `RosterPerson`, `MonthRoster` (Task 1); `isShiftCode`, `shift` da `./shifts.js`; `parseIso`, `IsoDate` da `./dates.js`.
- Produces: `RosterEntry` (`{ name: string; row: number | null; code: string; withYou: boolean }`), `overlaps(a: string, b: string): boolean`, `rosterOnDay(roster: MonthRoster | null, date: IsoDate, myCode: string): RosterEntry[]`, `countOverlapping(roster: MonthRoster | null, date: IsoDate, myCode: string): number`.

- [ ] **Step 1: Write the failing test**

Da aggiungere in fondo a `app/core/test/roster.test.ts`, insieme all'import di `countOverlapping`, `overlaps` e `rosterOnDay`:

```ts
describe('overlaps', () => {
  it('is false when the shifts only hand over: M ends when P begins', () => {
    expect(overlaps('M', 'P')).toBe(false);
  });

  it('is true when the hours really cross: M1 runs to 14, P starts at 13', () => {
    expect(overlaps('M1', 'P')).toBe(true);
  });

  it('is true for two shifts of the same kind', () => {
    expect(overlaps('P', 'P1')).toBe(true);
    expect(overlaps('M', 'M')).toBe(true);
  });

  it('is false for Libero, which has no hours to share', () => {
    expect(overlaps('L', 'M')).toBe(false);
    expect(overlaps('M', 'L')).toBe(false);
  });

  // The important one. An unknown code has no times, and guessing would be
  // worse than silence: saying "you are with Anna" when Anna is on nights is
  // a false statement, while saying nothing is only a missing one.
  it('is false whenever either side is a code the app does not know', () => {
    expect(overlaps('F', 'M')).toBe(false);
    expect(overlaps('M', 'N1')).toBe(false);
    expect(overlaps('F', 'F')).toBe(false);
    expect(overlaps('', 'M')).toBe(false);
  });
});

describe('rosterOnDay', () => {
  const roster = {
    year: 2026,
    month: 9,
    people: [
      { name: 'Giulia', row: 3, codes: ['P', ...Array(29).fill('')] },
      { name: 'Marta', row: 4, codes: ['M', ...Array(29).fill('')] },
      { name: 'Anna', row: 5, codes: ['F', ...Array(29).fill('')] },
      { name: 'Luca', row: 6, codes: ['L', ...Array(29).fill('')] },
      { name: 'Sara', row: 7, codes: ['', ...Array(29).fill('')] },
    ],
  };

  it('splits the day between who shares your hours and who is merely there', () => {
    const day = rosterOnDay(roster, '2026-09-01', 'P');
    expect(day.map((e) => [e.name, e.withYou])).toEqual([
      ['Giulia', true],
      ['Marta', false],
      ['Anna', false],
    ]);
  });

  it('leaves out the empty cells and the days off: neither is somebody at work', () => {
    const names = rosterOnDay(roster, '2026-09-01', 'P').map((e) => e.name);
    expect(names).not.toContain('Luca'); // L
    expect(names).not.toContain('Sara'); // empty cell
  });

  it('is empty for a date outside the month it holds', () => {
    expect(rosterOnDay(roster, '2026-10-01', 'P')).toEqual([]);
    expect(rosterOnDay(roster, '2025-09-01', 'P')).toEqual([]);
  });

  it('is empty when there is no roster at all', () => {
    expect(rosterOnDay(null, '2026-09-01', 'P')).toEqual([]);
  });

  it('still lists the day when she is off: who is in is a fact about the ward', () => {
    const day = rosterOnDay(roster, '2026-09-01', '');
    expect(day).toHaveLength(3);
    expect(day.every((e) => !e.withYou)).toBe(true);
  });
});

describe('countOverlapping', () => {
  const roster = {
    year: 2026,
    month: 9,
    people: [
      { name: 'Giulia', row: 3, codes: ['P', ...Array(29).fill('')] },
      { name: 'Marta', row: 4, codes: ['P1', ...Array(29).fill('')] },
      { name: 'Anna', row: 5, codes: ['M', ...Array(29).fill('')] },
    ],
  };

  it('counts only the ones who share the hours', () => {
    expect(countOverlapping(roster, '2026-09-01', 'P')).toBe(2);
  });

  it('is zero on a day she is not working', () => {
    expect(countOverlapping(roster, '2026-09-01', '')).toBe(0);
  });

  it('is zero on a day nobody is in', () => {
    expect(countOverlapping(roster, '2026-09-02', 'P')).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root core core/test/roster.test.ts`
Expected: FAIL — `overlaps`, `rosterOnDay`, `countOverlapping` non esistono.

- [ ] **Step 3: Write minimal implementation**

Da aggiungere a `app/core/src/roster.ts`, con `parseIso` e `IsoDate` aggiunti all'import di `./dates.js` e `isShiftCode`, `shift` importati da `./shifts.js`:

```ts
export interface RosterEntry {
  readonly name: string;
  readonly row: number | null;
  readonly code: string;
  /** Their hours cross hers. False for every code the app cannot place. */
  readonly withYou: boolean;
}

/** `HH:MM`, zero-padded, so a string comparison is a time comparison. */
function timesOf(code: string): { start: string; end: string } | null {
  if (!isShiftCode(code)) return null;
  const s = shift(code);
  // Libero has times of '': nobody is present for it.
  if (!s.start || !s.end) return null;
  return { start: s.start, end: s.end };
}

/** Together only when both codes resolve to known shifts whose intervals
 *  cross. Touching endpoints do not count: M ends at 13:00 and P starts at
 *  13:00 — they hand over, they do not meet. */
export function overlaps(a: string, b: string): boolean {
  const x = timesOf(a);
  const y = timesOf(b);
  if (!x || !y) return false;
  return x.start < y.end && y.start < x.end;
}

/** A known code worth no hours is somebody not there. An unknown code could
 *  be anything, so it stays and is simply never "with you". */
function offDuty(code: string): boolean {
  return isShiftCode(code) && shift(code).hours === 0;
}

export function rosterOnDay(
  roster: MonthRoster | null,
  date: IsoDate,
  myCode: string,
): RosterEntry[] {
  if (!roster) return [];
  const { year, month, day } = parseIso(date);
  if (year !== roster.year || month !== roster.month) return [];

  const out: RosterEntry[] = [];
  for (const p of roster.people) {
    const code = p.codes[day - 1] ?? '';
    if (!code || offDuty(code)) continue;
    out.push({ name: p.name, row: p.row, code, withYou: overlaps(myCode, code) });
  }
  return out;
}

export function countOverlapping(
  roster: MonthRoster | null,
  date: IsoDate,
  myCode: string,
): number {
  return rosterOnDay(roster, date, myCode).filter((e) => e.withYou).length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root core core/test/roster.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add app/core/src/roster.ts app/core/test/roster.test.ts
git commit -m "feat: insieme vuol dire ore che si incrociano, non lo stesso giorno"
```

---

### Task 3: il rimodellamento quando lei corregge il mese

**Files:**
- Modify: `app/core/src/roster.ts`
- Test: `app/core/test/roster.test.ts`

**Interfaces:**
- Consumes: `MonthRoster` (Task 1), `daysInMonth`.
- Produces: `reshapeRoster(r: MonthRoster, year: number, month: number): MonthRoster`.

**Perché questo task esiste.** La schermata di import lascia correggere il mese letto dal titolo (`setMonth` in `PhotoImport.tsx`), e quel mese è la `sk` sotto cui il roster viene scritto. Se la griglia di lei si rimodella e il roster no, i suoi turni finiscono in settembre e il roster in agosto — e il calendario mostra le persone sbagliate senza che niente lo segnali.

- [ ] **Step 1: Write the failing test**

```ts
describe('reshapeRoster', () => {
  const september = {
    year: 2026,
    month: 9,
    people: [{ name: 'Giulia', row: 3, codes: Array.from({ length: 30 }, (_, i) => `D${i}`) }],
  };

  it('grows into a longer month, the new days empty', () => {
    const r = reshapeRoster(september, 2026, 10); // 31 days
    expect(r.people[0]!.codes).toHaveLength(31);
    expect(r.people[0]!.codes[30]).toBe('');
    expect(r.people[0]!.codes[0]).toBe('D0');
  });

  it('shrinks into a shorter month, losing the days that no longer exist', () => {
    const r = reshapeRoster(september, 2026, 2); // 28 days
    expect(r.people[0]!.codes).toHaveLength(28);
    expect(r.people[0]!.codes[27]).toBe('D27');
  });

  it('carries the corrected month, which is the key it will be stored under', () => {
    expect(reshapeRoster(september, 2026, 10)).toMatchObject({ year: 2026, month: 10 });
  });

  it('keeps names and row numbers untouched', () => {
    const r = reshapeRoster(september, 2026, 10);
    expect(r.people[0]!.name).toBe('Giulia');
    expect(r.people[0]!.row).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root core core/test/roster.test.ts`
Expected: FAIL — `reshapeRoster` non esiste.

- [ ] **Step 3: Write minimal implementation**

```ts
/** The month read from the title can be corrected on the import screen, and
 *  retaking the photo would not help: the model would read the same title
 *  again. When it is corrected the roster has to follow, because that month is
 *  the key it gets stored under — her shifts under one month and the roster
 *  under another means the calendar shows the wrong people, with nothing to
 *  signal it. Same rule as her own grid: a shorter month loses the days that
 *  no longer exist, a longer one gains them empty. */
export function reshapeRoster(r: MonthRoster, year: number, month: number): MonthRoster {
  const howMany = daysInMonth(year, month);
  return {
    year,
    month,
    people: r.people.map((p) => ({
      ...p,
      codes: Array.from({ length: howMany }, (_, i) => p.codes[i] ?? ''),
    })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root core core/test/roster.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add app/core/src/roster.ts app/core/test/roster.test.ts
git commit -m "feat: se corregge il mese, il roster lo segue — o finiscono in due mesi diversi"
```

---

### Task 4: `readRoster` e `saveRoster` nel repo

**Files:**
- Modify: `app/api/src/repo.ts`
- Test: `app/api/test/repo.test.ts`

**Interfaces:**
- Consumes: `MonthRoster`, `RosterPerson` da `@vanessa/core` (Task 1).
- Produces: `rosterPk(year: number): string`, `rosterSk(month: number): string`, e su `Repo`: `readRoster(year: number, month: number): Promise<MonthRoster | null>`, `saveRoster(r: MonthRoster): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Da aggiungere a `app/api/test/repo.test.ts`. Il finto client qui è più semplice di `fakeDoc`, perché non c'è nessuna espressione da validare: `PutCommand` e `GetCommand` scrivono e leggono un item intero.

```ts
/** A fake holding one item per key. Enough for the roster, which is a whole
 *  item written and read back — no expressions, hence no reserved words. */
function fakeTable() {
  const items = new Map<string, Record<string, any>>();
  const doc = {
    async send(cmd: { input: Record<string, any>; constructor: { name: string } }) {
      const key = `${cmd.input.Key?.pk ?? cmd.input.Item?.pk}#${cmd.input.Key?.sk ?? cmd.input.Item?.sk}`;
      if (cmd.input.Item) {
        items.set(key, cmd.input.Item);
        return {};
      }
      return { Item: items.get(key) };
    },
  } as unknown as DynamoDBDocumentClient;
  return { doc, items };
}

describe('roster', () => {
  const september = {
    year: 2026,
    month: 9,
    people: [
      { name: 'Giulia', row: 3, codes: ['M', 'P', ...Array(28).fill('')] },
      { name: 'Marta', row: null, codes: ['P1', '', ...Array(28).fill('')] },
    ],
  };

  it('round-trips a month', async () => {
    const { doc } = fakeTable();
    const repo = createRepo('tabella', doc);
    await repo.saveRoster(september);
    expect(await repo.readRoster(2026, 9)).toEqual(september);
  });

  it('answers null for a month never imported', async () => {
    const { doc } = fakeTable();
    expect(await createRepo('tabella', doc).readRoster(2026, 9)).toBeNull();
  });

  it('writes under its own key, zero-padded, away from the shifts', async () => {
    const { doc, items } = fakeTable();
    await createRepo('tabella', doc).saveRoster(september);
    expect([...items.keys()]).toEqual(['ROSTER#2026#09']);
  });

  it('stores a month of codes as one string, not thirty attributes', async () => {
    const { doc, items } = fakeTable();
    await createRepo('tabella', doc).saveRoster(september);
    const stored = items.get('ROSTER#2026#09')!;
    expect(typeof stored.people[0].codes).toBe('string');
    expect(stored.people[0].codes.startsWith('M,P,,')).toBe(true);
  });

  // The whole reason this shape was chosen: replacing a month is one Put.
  it('replaces the month wholesale: whoever left the sheet really leaves', async () => {
    const { doc } = fakeTable();
    const repo = createRepo('tabella', doc);
    await repo.saveRoster(september);
    await repo.saveRoster({ ...september, people: [september.people[0]!] });

    const back = await repo.readRoster(2026, 9);
    expect(back!.people.map((p) => p.name)).toEqual(['Giulia']);
  });

  it('keeps the months of one year apart', async () => {
    const { doc } = fakeTable();
    const repo = createRepo('tabella', doc);
    await repo.saveRoster(september);
    await repo.saveRoster({ ...september, month: 10, people: [] });

    expect((await repo.readRoster(2026, 9))!.people).toHaveLength(2);
    expect((await repo.readRoster(2026, 10))!.people).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root api api/test/repo.test.ts`
Expected: FAIL — `saveRoster` non è sul repo.

- [ ] **Step 3: Write minimal implementation**

In `app/api/src/repo.ts`, aggiungere `MonthRoster` all'import di tipo da `@vanessa/core`, e:

```ts
export function rosterPk(year: number): string {
  return `ROSTER#${year}`;
}

/** Zero-padded, so the twelve months of a year sort in order. */
export function rosterSk(month: number): string {
  return String(month).padStart(2, '0');
}
```

Sull'interfaccia `Repo`:

```ts
  /** The month's roster as last imported, or null if never imported. */
  readRoster(year: number, month: number): Promise<MonthRoster | null>;
  /** Replaces that month wholesale. One Put: there is no moment in which the
   *  month is half-written, which is why it is one item and not one per
   *  person-day. */
  saveRoster(r: MonthRoster): Promise<void>;
```

E nell'oggetto restituito da `createRepo`:

```ts
    async readRoster(year, month) {
      const r = await doc.send(
        new GetCommand({ TableName: table, Key: { pk: rosterPk(year), sk: rosterSk(month) } }),
      );
      if (!r.Item) return null;
      const raw = Array.isArray(r.Item.people) ? r.Item.people : [];
      const people = raw
        .map((v: Record<string, unknown>) => ({
          name: typeof v.name === 'string' ? v.name : '',
          row: typeof v.row === 'number' ? v.row : null,
          codes: typeof v.codes === 'string' && v.codes.length > 0 ? v.codes.split(',') : [],
        }))
        .filter((p: { name: string }) => p.name !== '');
      return { year, month, people };
    },

    async saveRoster(r) {
      await doc.send(
        new PutCommand({
          TableName: table,
          Item: {
            pk: rosterPk(r.year),
            sk: rosterSk(r.month),
            // One string per person instead of a list of thirty-one values:
            // fifteen people would otherwise be some five hundred attribute
            // values in an item that is never read in pieces. `normaliseCode`
            // keeps the separator out of the codes themselves.
            people: r.people.map((p) => ({
              name: p.name,
              ...(p.row == null ? {} : { row: p.row }),
              codes: p.codes.join(','),
            })),
          },
        }),
      );
    },
```

**Attenzione al mese vuoto.** `''.split(',')` restituisce `['']`, non `[]`: per questo il ramo `v.codes.length > 0`. Un mese senza persone è una lista vuota e non passa mai di lì.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root api api/test/repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: verde. Se un altro finto `Repo` in `handlers.test.ts` non compila, aggiungere lì i due metodi — è esattamente ciò che `npm test` da solo non vedrebbe.

- [ ] **Step 6: Commit**

```bash
git add app/api/src/repo.ts app/api/test/repo.test.ts
git commit -m "feat: il roster di un mese è un item solo, così sostituirlo è una Put"
```

---

### Task 5: il prompt legge tutte le righe

**Files:**
- Modify: `app/api/src/vision.ts`
- Test: `app/api/test/vision.test.ts`

**Interfaces:**
- Consumes: `READING_SCHEMA`, `ROW_NAME`, `SHIFTS` da `@vanessa/core` (già importati).
- Produces: nessuna firma nuova. `READING_SCHEMA` guadagna la proprietà `others`; `MAX_TOKENS` diventa 16000.

**Dove va `others`.** Nello stesso `READING_SCHEMA` in `core/src/photo.ts`: la chiamata al modello è una, quindi lo schema è uno. `validateReading` continua a ignorare `others` — non lo legge e non lo valida — e `validateRoster` lo legge dallo stesso oggetto grezzo.

- [ ] **Step 1: Write the failing test**

In `app/core/test/photo.test.ts` (lo schema vive in `core`):

```ts
describe('READING_SCHEMA', () => {
  it('asks for the other rows too, in a shape of their own', () => {
    const props = READING_SCHEMA.properties as Record<string, any>;
    expect(props.others.type).toBe('array');
    expect(Object.keys(props.others.items.properties).sort()).toEqual(['codes', 'name', 'row']);
  });

  // No `confident` on other people's cells: the flag exists to underline a
  // cell she can correct, and there is no per-cell editing for them.
  it('does not ask for a confidence flag on the other rows', () => {
    const props = READING_SCHEMA.properties as Record<string, any>;
    expect(props.others.items.properties.confident).toBeUndefined();
  });

  it('still asks for her own row exactly as before', () => {
    const props = READING_SCHEMA.properties as Record<string, any>;
    expect(Object.keys(props.days.items.properties).sort()).toEqual(['code', 'confident', 'day']);
  });
});
```

E in `app/api/test/vision.test.ts`:

```ts
describe('the prompt and the token budget', () => {
  it('raises the cap, because the response now carries the whole sheet', () => {
    expect(MAX_TOKENS).toBe(16000);
  });

  it('still tells the model to align on the day-number header row', async () => {
    const { bodies } = fakeClient();
    await createVision(bodies.client)('abc');
    const text = bodies.sent[0].messages[0].content[1].text as string;
    expect(text).toContain('numeri dei giorni');
  });

  it('asks for the other rows instead of forbidding them', async () => {
    const { bodies } = fakeClient();
    await createVision(bodies.client)('abc');
    const text = bodies.sent[0].messages[0].content[1].text as string;
    expect(text).not.toContain('UNA SOLA riga');
    expect(text).toContain('tutte le altre righe');
  });
});
```

Il finto client `fakeClient()` si modella su quelli già presenti in `vision.test.ts`: cattura il body passato a `messages.create` e risponde con un blocco di testo JSON valido. Riusare quello che c'è, non scriverne un secondo.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root core core/test/photo.test.ts && npx vitest run --root api api/test/vision.test.ts`
Expected: FAIL — `others` non è nello schema, `MAX_TOKENS` è 8000.

- [ ] **Step 3: Write minimal implementation**

In `app/core/src/photo.ts`, dentro `READING_SCHEMA.properties`, dopo `days`:

```ts
    /** The other rows, in a shape of their own: a name and a flat list of
     *  codes. Her row's shape costs about 25 tokens a day; fifteen people in
     *  that shape would be some twelve thousand tokens of JSON alone, and the
     *  answer would be truncated. This is about seven hundred for the lot. */
    others: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          row: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          codes: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'row', 'codes'],
        additionalProperties: false,
      },
    },
```

e aggiungere `'others'` all'array `required` dello schema.

In `app/api/src/vision.ts`, esportare il tetto e alzarlo:

```ts
/** Reasoning plus response together. Raised from 8000 when the response went
 *  from one row to the whole sheet: too tight and it truncates halfway, which
 *  surfaces as VisionFailed('truncated') and costs a reading. */
export const MAX_TOKENS = 16000;
```

E nel `PROMPT`, sostituire il blocco che va da `Devi leggere UNA SOLA riga` fino a `Non riportare mai la cella di un'altra riga.` con:

```
Devi leggere TUTTE le righe della griglia.
I nomi stanno a sinistra, su due righe (cognome sopra, nome sotto): la riga dei
turni e' quella del nome.

La riga della persona di nome ${ROW_NAME} va in days, un elemento per OGNI
giorno del mese, dal primo all'ultimo, anche per i giorni con code null.
Le sigle valide per quella riga sono soltanto: ${CODES}.
Se la cella contiene una x, e' vuota, oppure non riesci a leggerla con
ragionevole certezza, metti code null. Metti confident a false quando la cella
e' sbiadita, corretta a mano, ambigua o coperta.

Tutte le altre righe vanno in others, una per persona, con il nome cosi' come
sta scritto sul foglio e un elenco codes lungo quanto il mese.
Le altre righe contengono anche sigle diverse (F, R, C, N1 e altre): copiale
cosi' come sono, senza tradurle e senza scartarle. Per una cella vuota, con una
x, o illeggibile, metti la stringa vuota.
```

Il resto del prompt — la griglia, la riga dei numeri dei giorni, `foundName`/`foundRow`, il caso `found: false` — **non si tocca**. L'allineamento sulla riga dei numeri è ciò che ha risolto il fuori-registro di luglio, e con quindici righe conta di più.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --root core core/test/photo.test.ts && npx vitest run --root api api/test/vision.test.ts`
Expected: PASS. I test esistenti di `validateReading` restano verdi: `others` non è validato lì.

- [ ] **Step 5: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add app/core/src/photo.ts app/api/src/vision.ts app/core/test/photo.test.ts app/api/test/vision.test.ts
git commit -m "feat: il modello legge tutto il foglio, gli altri in forma compatta"
```

---

### Task 6: le rotte e la risposta della foto

**Files:**
- Modify: `app/api/src/http.ts`, `app/api/src/handlers.ts`
- Test: `app/api/test/http.test.ts`, `app/api/test/handlers.test.ts`

**Interfaces:**
- Consumes: `validateRoster` (Task 1), `readRoster`/`saveRoster` (Task 4), `InvalidInput`, `requireObject`, `optionalText`, `requireFromCloudFront`, `handle`, `ok`, `parseJson`.
- Produces: `requireYearMonth(p): { year: number; month: number }`, `MAX_ROSTER_PEOPLE`, `requireRosterPeople(b, days): RosterPerson[]`, `getRosterWith(repo)`, `putRosterWith(repo)`, e gli entry point `getRoster`, `putRoster`.

- [ ] **Step 1: Write the failing test**

In `app/api/test/http.test.ts`:

```ts
describe('requireYearMonth', () => {
  it('reads the two path parameters', () => {
    expect(requireYearMonth({ year: '2026', month: '09' })).toEqual({ year: 2026, month: 9 });
  });

  it('refuses a month outside the year', () => {
    expect(() => requireYearMonth({ year: '2026', month: '13' })).toThrow(InvalidInput);
    expect(() => requireYearMonth({ year: '2026', month: '0' })).toThrow(InvalidInput);
  });

  it('refuses what is not a year, including nothing at all', () => {
    expect(() => requireYearMonth({ year: 'ciao', month: '9' })).toThrow(InvalidInput);
    expect(() => requireYearMonth(undefined)).toThrow(InvalidInput);
  });
});

describe('requireRosterPeople', () => {
  const people = [{ name: 'Giulia', row: 3, codes: Array(30).fill('M') }];

  it('accepts a well-formed body', () => {
    expect(requireRosterPeople({ people }, 30)).toEqual(people);
  });

  it('normalises the codes on the way in', () => {
    const r = requireRosterPeople({ people: [{ name: 'Giulia', row: null, codes: [' m1 ', ...Array(29).fill('')] }] }, 30);
    expect(r[0]!.codes[0]).toBe('M1');
  });

  // Strict here, unlike validateRoster: this body comes from our own client,
  // which has already validated it. A malformed one is a bug, not a bad photo.
  it('refuses a row that is not the length of the month', () => {
    expect(() => requireRosterPeople({ people: [{ name: 'Giulia', row: 3, codes: ['M'] }] }, 30)).toThrow(
      InvalidInput,
    );
  });

  it('refuses a nameless person and a missing list', () => {
    expect(() => requireRosterPeople({ people: [{ name: '  ', row: 3, codes: Array(30).fill('') }] }, 30)).toThrow(InvalidInput);
    expect(() => requireRosterPeople({}, 30)).toThrow(InvalidInput);
  });

  it('caps how many people one month can hold', () => {
    const many = Array.from({ length: MAX_ROSTER_PEOPLE + 1 }, (_, i) => ({
      name: `P${i}`,
      row: null,
      codes: Array(30).fill(''),
    }));
    expect(() => requireRosterPeople({ people: many }, 30)).toThrow(InvalidInput);
  });
});
```

In `app/api/test/handlers.test.ts`. Il file ha già i suoi aiutanti — `fakeRepo()`, `event()`, `body()` — e si usano quelli: `f` è il `fakeRepo` creato nel `beforeEach`.

```ts
/** A reading of July with other rows attached. `julyReading()` is the helper
 *  already in core's tests; here the shape is built inline to keep the two
 *  suites independent. */
function rawWithOthers(others: unknown) {
  return {
    month: 7,
    year: 2026,
    found: true,
    foundName: 'Vanessa',
    foundRow: 14,
    days: Array.from({ length: 31 }, (_, i) => ({ day: i + 1, code: null, confident: true })),
    others,
  };
}

const readPhotoEvent = () =>
  event({ body: JSON.stringify({ image: 'abc' }), headers: {} });

describe('readPhoto and the roster', () => {
  it('returns the roster beside the reading', async () => {
    const raw = rawWithOthers([{ name: 'Giulia', row: 3, codes: Array(31).fill('M') }]);
    const r = await readPhotoWith(f.repo, async () => raw, () => '2026-07-02', () => 2026, async () => {})(
      readPhotoEvent(),
    );
    expect(body(r).reading.days).toHaveLength(31);
    expect(body(r).roster.people[0].name).toBe('Giulia');
  });

  // The asymmetry, end to end: a roster that cannot be used must never take
  // down a reading that can.
  it('still answers 200 with the reading when the other rows are rubbish', async () => {
    const r: any = await readPhotoWith(f.repo, async () => rawWithOthers('not an array'), () => '2026-07-02', () => 2026, async () => {})(
      readPhotoEvent(),
    );
    expect(r.statusCode).toBe(200);
    expect(body(r).roster.people).toEqual([]);
  });

  it('takes the roster month from the reading, not from a field of its own', async () => {
    const raw = rawWithOthers([{ name: 'Giulia', row: 3, codes: Array(31).fill('M') }]);
    const r = await readPhotoWith(f.repo, async () => raw, () => '2026-07-02', () => 2026, async () => {})(
      readPhotoEvent(),
    );
    expect(body(r).roster.month).toBe(7);
  });
});

describe('GET /roster', () => {
  it('reads a month', async () => {
    await f.repo.saveRoster({ year: 2026, month: 9, people: [] });
    const r = await getRosterWith(f.repo)(event({ pathParameters: { year: '2026', month: '09' } }));
    expect(body(r).roster.month).toBe(9);
  });

  it('answers with a null roster for a month never imported', async () => {
    const r = await getRosterWith(f.repo)(event({ pathParameters: { year: '2026', month: '09' } }));
    expect(body(r).roster).toBeNull();
  });

  it('refuses a month outside the year', async () => {
    const r: any = await getRosterWith(f.repo)(event({ pathParameters: { year: '2026', month: '13' } }));
    expect(r.statusCode).toBe(400);
  });
});

describe('PUT /roster', () => {
  const people = [{ name: 'Giulia', row: 3, codes: Array(30).fill('M') }];

  it('saves the month named in the path, not one named in the body', async () => {
    await putRosterWith(f.repo)(
      event({
        pathParameters: { year: '2026', month: '09' },
        body: JSON.stringify({ people, year: 1999, month: 1 }),
      }),
    );
    expect(await f.repo.readRoster(2026, 9)).toMatchObject({ year: 2026, month: 9 });
    expect(await f.repo.readRoster(1999, 1)).toBeNull();
  });

  it('refuses a body whose rows are not the length of that month', async () => {
    const r: any = await putRosterWith(f.repo)(
      event({
        pathParameters: { year: '2026', month: '09' },
        body: JSON.stringify({ people: [{ name: 'Giulia', row: 3, codes: Array(31).fill('M') }] }),
      }),
    );
    expect(r.statusCode).toBe(400);
  });
});
```

**`fakeRepo()` va allargato** con `readRoster` e `saveRoster`, tenuti in una `Map` come fa già per gli altri: senza, il file non compila. È esattamente ciò che `npm test` da solo non segnalerebbe.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --root api api/test/http.test.ts api/test/handlers.test.ts`
Expected: FAIL — le funzioni non esistono.

- [ ] **Step 3: Write minimal implementation**

In `app/api/src/http.ts` (importando `normaliseCode` e il tipo `RosterPerson` da `@vanessa/core`):

```ts
export function requireYearMonth(
  p: Record<string, string | undefined> | undefined,
): { year: number; month: number } {
  const year = Number(p?.year);
  const month = Number(p?.month);
  // Number(undefined) is NaN and Number('') is 0: both fail this.
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new InvalidInput('year: expected a year');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new InvalidInput('month: out of 1-12');
  }
  return { year, month };
}

/** A ward is not this big. The cap is what keeps one item inside DynamoDB's
 *  400 KB, and a malformed client from writing a book. */
export const MAX_ROSTER_PEOPLE = 60;

/** Strict, unlike `validateRoster`. That one judges what a model said it read
 *  from a photograph; this one judges a body our own client has already
 *  validated, where anything malformed is a bug worth hearing about. */
export function requireRosterPeople(
  b: Record<string, unknown>,
  days: number,
): RosterPerson[] {
  const raw = b.people;
  if (!Array.isArray(raw)) throw new InvalidInput('people: expected an array');
  if (raw.length > MAX_ROSTER_PEOPLE) {
    throw new InvalidInput(`people: at most ${MAX_ROSTER_PEOPLE}`);
  }
  return raw.map((v, i) => {
    const p = requireObject(v, `people[${i}]`);
    const name = optionalText(p.name, `people[${i}].name`, 80);
    if (!name) throw new InvalidInput(`people[${i}].name: expected a name`);
    if (!Array.isArray(p.codes) || p.codes.length !== days) {
      throw new InvalidInput(`people[${i}].codes: expected ${days} entries`);
    }
    return {
      name,
      row: typeof p.row === 'number' && Number.isInteger(p.row) ? p.row : null,
      codes: p.codes.map(normaliseCode),
    };
  });
}
```

In `app/api/src/handlers.ts`, dentro `readPhotoWith`, sostituire il `return ok(...)`:

```ts
        // `validateReading` speaks first, and on purpose: if her row fails the
        // request fails exactly as it did before. `validateRoster` cannot
        // throw a request away — at worst it yields an empty `people`. The
        // month comes from the reading rather than a field of its own: the
        // photo is one, and two sources for one month could disagree.
        const reading = validateReading(raw, year());
        return ok({ reading, roster: validateRoster(raw, reading.year, reading.month) });
```

E in fondo, le due rotte nuove:

```ts
export function getRosterWith(repo: Repo) {
  return (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    handle(async () => {
      requireFromCloudFront(event.headers);
      const { year, month } = requireYearMonth(event.pathParameters);
      return ok({ roster: await repo.readRoster(year, month) });
    });
}

/** Separate from `PUT /shifts` deliberately: her shifts never delete, this
 *  replaces the month wholesale. One handler holding both promises would be
 *  a handler contradicting itself. */
export function putRosterWith(repo: Repo) {
  return (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    handle(async () => {
      requireFromCloudFront(event.headers);
      const { year, month } = requireYearMonth(event.pathParameters);
      const people = requireRosterPeople(parseJson(event.body), daysInMonth(year, month));
      await repo.saveRoster({ year, month, people });
      return ok({ saved: people.length });
    });
}
```

più gli entry point accanto agli altri:

```ts
export const getRoster = (e: APIGatewayProxyEventV2) => getRosterWith(repoFromEnvironment())(e);
export const putRoster = (e: APIGatewayProxyEventV2) => putRosterWith(repoFromEnvironment())(e);
```

Aggiornare il commento di testa del file: *«The four Lambda handlers»* diventa *«The six Lambda handlers»*. E aggiungere `daysInMonth`, `validateRoster` all'import da `@vanessa/core`, `requireYearMonth`, `requireRosterPeople` a quello da `./http.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --root api api/test/http.test.ts api/test/handlers.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add app/api/src/http.ts app/api/src/handlers.ts app/api/test/http.test.ts app/api/test/handlers.test.ts
git commit -m "feat: due rotte per il roster, e la foto ne restituisce uno"
```

---

### Task 7: due Lambda, due rotte, e i test dell'infrastruttura che contano fino a cinque

**Files:**
- Modify: `app/infra/lib/app-stack.ts`
- Test: `app/infra/test/stacks.test.ts`

**Interfaces:**
- Consumes: gli entry point `getRoster` e `putRoster` (Task 6).
- Produces: nessuna firma. Due `NodejsFunction` e due rotte autenticate.

**Attenzione.** Tre test in `stacks.test.ts` contano le rotte e le Lambda e si aspettano **cinque**. Non sono da aggirare: sono da aggiornare a sette, ed è la ragione per cui questo task esiste come task a sé.

- [ ] **Step 1: Update the failing tests**

In `app/infra/test/stacks.test.ts`, tre modifiche:

```ts
  it('there is one per route', () => {
    const fn = app.findResources('AWS::Lambda::Function');
    const nostre = Object.values(fn).filter((f: any) =>
      ['getShifts', 'putShift', 'putShifts', 'getConfig', 'putConfig', 'getRoster', 'putRoster'].includes(
        f.Properties?.Handler?.split('.').pop(),
      ),
    );
    expect(nostre).toHaveLength(7);
  });
```

```ts
  it('exposes the seven expected routes, under /api so CloudFront can forward the path as it is', () => {
    const rotte = Object.values(app.findResources('AWS::ApiGatewayV2::Route')).map(
      (r: any) => r.Properties.RouteKey,
    );
    expect(rotte).toEqual(
      expect.arrayContaining([
        'GET /api/shifts',
        'PUT /api/shifts',
        'PUT /api/shifts/{date}',
        'GET /api/config',
        'PUT /api/config',
        'GET /api/roster/{year}/{month}',
        'PUT /api/roster/{year}/{month}',
      ]),
    );
  });
```

```ts
  it('puts an authorizer on all seven API routes', () => {
    const routes = app.findResources('AWS::ApiGatewayV2::Route');
    expect(Object.keys(routes)).toHaveLength(7);
    for (const r of Object.values(routes)) {
      expect(r.Properties.AuthorizationType).toBe('JWT');
      expect(r.Properties.AuthorizerId).toBeDefined();
    }
  });
```

E aggiungere il percorso nuovo all'elenco del test `routes the API under /api`:

```ts
    for (const path of ['/api/shifts', '/api/shifts/{date}', '/api/config', '/api/roster/{year}/{month}']) {
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --root infra infra/test/stacks.test.ts`
Expected: FAIL — ci sono cinque rotte e cinque Lambda, non sette.

- [ ] **Step 3: Write minimal implementation**

In `app/infra/lib/app-stack.ts`, accanto alle altre:

```ts
    const getRosterFn = lambda('GetRoster', 'getRoster');
    const putRosterFn = lambda('PutRoster', 'putRoster');
```

fra i permessi, rispettando il minimo privilegio già in uso:

```ts
    table.grantReadData(getRosterFn);
    table.grantReadWriteData(putRosterFn);
```

e fra le rotte:

```ts
    route('/api/roster/{year}/{month}', HttpMethod.GET, getRosterFn, 'IntGetRoster');
    route('/api/roster/{year}/{month}', HttpMethod.PUT, putRosterFn, 'IntPutRoster');
```

Due commenti diventati falsi, da correggere nello stesso commit:

- `// The five API routes are checked by the gateway…` → `// The seven API routes…`
- `// …The other five routes are untouched.` (sopra `readPhotoFn`) → `// …The other seven routes are untouched.`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --root infra infra/test/stacks.test.ts`
Expected: PASS. In particolare `read-only lambdas hold no write permissions` resta verde: `getRosterFn` ha sola lettura.

- [ ] **Step 5: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add app/infra/lib/app-stack.ts app/infra/test/stacks.test.ts
git commit -m "feat: le rotte del roster, e i commenti che contavano fino a cinque"
```

---

### Task 8: il client

**Files:**
- Modify: `app/web/src/api.ts`
- Test: `app/web/test/api.test.ts`

**Interfaces:**
- Consumes: le rotte del Task 6.
- Produces: `PhotoRead` (`{ reading: PhotoReading; roster: MonthRoster }`); su `Api`: `readPhoto(image: string): Promise<PhotoRead>` (**firma cambiata**), `roster(year: number, month: number): Promise<MonthRoster | null>`, `saveRoster(r: MonthRoster): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
describe('roster', () => {
  it('asks for the month zero-padded, as it is stored', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      urls.push(u);
      return jsonResponse({ roster: null });
    });
    await api.roster(2026, 9);
    expect(urls[0]).toBe('/api/roster/2026/09');
  });

  it('hands back null for a month never imported', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ roster: null }));
    expect(await api.roster(2026, 9)).toBeNull();
  });

  it('sends only the people: the month is in the path', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return jsonResponse({ saved: 1 });
    });
    await api.saveRoster({ year: 2026, month: 9, people: [{ name: 'Giulia', row: 3, codes: Array(30).fill('M') }] });
    expect(Object.keys(JSON.parse(bodies[0]!))).toEqual(['people']);
  });
});

describe('readPhoto', () => {
  it('hands back the reading and the roster together', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse({ reading: { month: 9, year: 2026, found: true, foundName: 'Vanessa', foundRow: 14, days: [] }, roster: { year: 2026, month: 9, people: [] } }),
    );
    const r = await api.readPhoto('abc');
    expect(r.reading.foundName).toBe('Vanessa');
    expect(r.roster.people).toEqual([]);
  });

  // An older handler, mid-deploy, answers without a roster. The screen must
  // still work: her row is the part that matters.
  it('survives a response with no roster at all', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse({ reading: { month: 9, year: 2026, found: true, foundName: 'Vanessa', foundRow: 14, days: [] } }),
    );
    const r = await api.readPhoto('abc');
    expect(r.roster).toEqual({ year: 2026, month: 9, people: [] });
  });
});
```

`jsonResponse(body)` è l'aiutante già usato nel file per costruire una `Response` con `content-type: application/json`; riusare quello.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root web web/test/api.test.ts`
Expected: FAIL — `api.roster` non esiste, `readPhoto` restituisce solo il reading.

- [ ] **Step 3: Write minimal implementation**

In `app/web/src/api.ts`, importare `MonthRoster` da `@vanessa/core` e aggiungere:

```ts
export interface PhotoRead {
  reading: PhotoReading;
  roster: MonthRoster;
}

/** Zero-padded, matching the sort key the month is stored under. */
function mm(month: number): string {
  return String(month).padStart(2, '0');
}
```

Sull'interfaccia `Api`:

```ts
  roster(year: number, month: number): Promise<MonthRoster | null>;
  saveRoster(r: MonthRoster): Promise<void>;
  readPhoto(image: string): Promise<PhotoRead>;
```

E nell'oggetto:

```ts
  async roster(year, month) {
    const r = await request<{ roster: MonthRoster | null }>(`/roster/${year}/${mm(month)}`);
    return r.roster;
  },
  async saveRoster(r) {
    await request(`/roster/${r.year}/${mm(r.month)}`, {
      method: 'PUT',
      body: JSON.stringify({ people: r.people }),
    });
  },
```

In `readPhoto`, il solo blocco finale cambia:

```ts
      const j = (await r.json()) as { reading: PhotoReading; roster?: MonthRoster };
      // A deploy replaces the bundle and the Lambda as independent resources,
      // so for a moment the new bundle can be talking to a handler that knows
      // nothing about rosters. Her row is what matters: an absent roster is an
      // empty one, not a failed reading.
      return { reading: j.reading, roster: j.roster ?? { year: j.reading.year, month: j.reading.month, people: [] } };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root web web/test/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: **il typecheck fallisce**, ed è giusto: `readPhoto` ha cambiato forma e `BulkEntry`/`PhotoImport` dichiarano ancora la vecchia. Portare le due firme a `Promise<PhotoRead>` senza usarne ancora il roster — l'uso arriva nel Task 9 — e rieseguire.

- [ ] **Step 6: Commit**

```bash
git add app/web/src/api.ts app/web/src/BulkEntry.tsx app/web/src/PhotoImport.tsx app/web/test/api.test.ts
git commit -m "feat: il client chiede il roster, e sopravvive a un handler che non lo conosce"
```

---

### Task 9: l'import — il blocco richiudibile e l'ordine di salvataggio

**Files:**
- Modify: `app/web/src/PhotoImport.tsx`, `app/web/src/BulkEntry.tsx`
- Test: `app/web/test/photoImport.test.tsx`

**Interfaces:**
- Consumes: `PhotoRead` (Task 8), `reshapeRoster` (Task 3), `MonthRoster`.
- Produces: su `PhotoImportProps` e `BulkEntryProps`, la prop `onSaveRoster: (r: MonthRoster) => Promise<void>`.

- [ ] **Step 1: Write the failing test**

```tsx
const ROSTER = {
  year: 2026,
  month: 9,
  people: [
    { name: 'Giulia', row: 3, codes: Array(30).fill('M') },
    { name: 'Marta', row: 4, codes: Array(30).fill('P') },
  ],
};

function readOk() {
  return async () => ({ reading: settembreReading(), roster: ROSTER });
}

describe('PhotoImport and the other rows', () => {
  it('says how many people it read, without listing them unasked', async () => {
    render(<PhotoImport year={2026} existing={new Map()} onRead={readOk()} onSave={async () => {}} onSaveRoster={async () => {}} />);
    await caricaFoto();
    expect(await screen.findByText(/lette 2 persone/i)).toBeInTheDocument();
    expect(screen.queryByText('Giulia')).not.toBeInTheDocument();
  });

  it('opens on request, so a row shifted or a name misread can be seen', async () => {
    render(<PhotoImport year={2026} existing={new Map()} onRead={readOk()} onSave={async () => {}} onSaveRoster={async () => {}} />);
    await caricaFoto();
    await userEvent.click(screen.getByRole('button', { name: /lette 2 persone/i }));
    expect(screen.getByText('Giulia')).toBeInTheDocument();
    expect(screen.getByText('Marta')).toBeInTheDocument();
  });

  it('saves her shifts before the roster', async () => {
    const order: string[] = [];
    render(
      <PhotoImport year={2026} existing={new Map()} onRead={readOk()}
        onSave={async () => { order.push('shifts'); }}
        onSaveRoster={async () => { order.push('roster'); }} />,
    );
    await caricaFoto();
    await salva();
    expect(order).toEqual(['shifts', 'roster']);
  });

  // Her import succeeded. Saying otherwise would send her back to redo work
  // that is already stored.
  it('reports a roster that failed without claiming the import failed', async () => {
    render(
      <PhotoImport year={2026} existing={new Map()} onRead={readOk()}
        onSave={async () => {}}
        onSaveRoster={async () => { throw new Error('rete giù'); }} />,
    );
    await caricaFoto();
    await salva();
    expect(await screen.findByText(/turni sono salvati/i)).toBeInTheDocument();
    expect(screen.getByText(/rete giù/i)).toBeInTheDocument();
  });

  it('reshapes the roster when she corrects the month, so both are stored under one month', async () => {
    const saved: MonthRoster[] = [];
    render(
      <PhotoImport year={2026} existing={new Map()} onRead={readOk()}
        onSave={async () => {}} onSaveRoster={async (r) => { saved.push(r); }} />,
    );
    await caricaFoto();
    await userEvent.selectOptions(screen.getByLabelText('Mese'), '10'); // 31 days
    await salva();
    expect(saved[0]!.month).toBe(10);
    expect(saved[0]!.people[0]!.codes).toHaveLength(31);
  });

  it('does not call the roster endpoint when nobody else was read', async () => {
    let called = 0;
    render(
      <PhotoImport year={2026} existing={new Map()}
        onRead={async () => ({ reading: settembreReading(), roster: { year: 2026, month: 9, people: [] } })}
        onSave={async () => {}} onSaveRoster={async () => { called += 1; }} />,
    );
    await caricaFoto();
    await salva();
    expect(called).toBe(0);
  });
});
```

`caricaFoto()` e `salva()` sono aiutanti locali sulla falsariga di quelli già nel file: il primo mette un file sull'input e attende la griglia, il secondo preme il pulsante di `SavePlan` e attende.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root web web/test/photoImport.test.tsx`
Expected: FAIL — la prop `onSaveRoster` non esiste e il blocco non c'è.

- [ ] **Step 3: Write minimal implementation**

In `app/web/src/PhotoImport.tsx`:

1. `PhotoImportProps` guadagna `onSaveRoster: (r: MonthRoster) => Promise<void>` e `onRead` diventa `(image: string) => Promise<PhotoRead>`.
2. Stato nuovo: `const [roster, setRoster] = useState<MonthRoster | null>(null)`, `const [openRoster, setOpenRoster] = useState(false)`, `const [rosterError, setRosterError] = useState<string | null>(null)`.
3. In `pick`: `const { reading, roster } = await onRead(await resize(file)); setReading(fromReading(reading)); setRoster(roster);`
4. In `setMonth`, subito dopo `setReading(...)`:

```tsx
    // The corrected month is the key the roster is stored under. If her grid
    // reshapes and the roster does not, her shifts land in one month and the
    // roster in another, and the calendar shows the wrong people with nothing
    // to signal it.
    setRoster((r) => (r === null ? r : reshapeRoster(r, r.year, month)));
    setRosterError(null);
```

5. Un handler di salvataggio che passa a `SavePlan` al posto di `onSave`:

```tsx
  const save = async (entries: readonly { date: IsoDate; code: ShiftCode }[]) => {
    // Her shifts first: they are the part that matters, and the part pay is
    // computed from.
    await onSave(entries);
    setRosterError(null);
    if (!roster || roster.people.length === 0) return;
    try {
      await onSaveRoster(roster);
    } catch (e) {
      // Her import succeeded. Failing the whole save here would send her back
      // to redo work that is already stored.
      setRosterError((e as Error).message);
    }
  };
```

6. Il blocco, sotto la griglia e sopra `SavePlan`:

```tsx
{roster && roster.people.length > 0 && (
  <div className="roster-read">
    <button type="button" className="toggle" aria-expanded={openRoster} onClick={() => setOpenRoster((o) => !o)}>
      lette {roster.people.length} persone
    </button>
    {openRoster && (
      <div className="roster-grid" role="group" aria-label="Turni letti degli altri">
        {roster.people.map((p, i) => (
          <div className="roster-row" key={`${p.name}-${p.row ?? i}`}>
            <span className="roster-name">{p.name}</span>
            {p.codes.map((c, d) => (
              <span key={d} className={c ? `t-${c}` : 'empty'}>{c || '–'}</span>
            ))}
          </div>
        ))}
      </div>
    )}
  </div>
)}
{rosterError && (
  <p className="error" role="alert">
    I tuoi turni sono salvati. I turni degli altri no: {rosterError}
  </p>
)}
```

La chiave usa `p.row` oltre al nome: due righe con lo stesso nome sono due persone, e una chiave sul solo nome le farebbe collidere.

7. In `app/web/src/BulkEntry.tsx`, aggiungere `onSaveRoster` a `BulkEntryProps` e passarla a `<PhotoImport>`. `BulkEntry` non la usa per sé.

8. In `styles.css`, `.roster-grid` scorre in orizzontale (`overflow-x: auto`) e `.roster-row` è una griglia a colonne strette: trentun celle non stanno nella larghezza di un telefono, e lo scorrimento è preferibile a celle illeggibili.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root web web/test/photoImport.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: il typecheck segnala `App.tsx`, che non passa ancora `onSaveRoster`. Passare `async () => {}` come segnaposto **non va bene**: collegarla davvero nel Task 11. Per chiudere questo task, passare `api.saveRoster` direttamente in `App.tsx` — una riga — e lasciare al Task 11 il caricamento e il resto.

- [ ] **Step 6: Commit**

```bash
git add app/web/src/PhotoImport.tsx app/web/src/BulkEntry.tsx app/web/src/App.tsx app/web/src/styles.css app/web/test/photoImport.test.tsx
git commit -m "feat: l'import tiene gli altri, e un roster che fallisce non annulla i suoi turni"
```

---

### Task 10: il conteggio nella cella

**Files:**
- Modify: `app/web/src/Calendar.tsx`
- Test: `app/web/test/app.test.tsx`

**Interfaces:**
- Consumes: `countOverlapping` (Task 2), `MonthRoster`.
- Produces: su `CalendarProps`, la prop opzionale `roster?: MonthRoster | null`.

- [ ] **Step 1: Write the failing test**

```tsx
describe('Calendar and who is in with her', () => {
  const roster = {
    year: 2026,
    month: 9,
    people: [
      { name: 'Giulia', row: 3, codes: ['P', ...Array(29).fill('')] },
      { name: 'Marta', row: 4, codes: ['P1', ...Array(29).fill('')] },
      { name: 'Anna', row: 5, codes: ['M', ...Array(29).fill('')] },
    ],
  };
  const shifts = new Map([['2026-09-01', { code: 'P' as const, hoursOverride: null }]]);

  it('counts only the ones who share her hours', () => {
    render(<Calendar year={2026} month={9} shifts={shifts} roster={roster} selected={null} onPick={() => {}} />);
    expect(screen.getByRole('button', { name: /1 settembre/ })).toHaveTextContent('2');
  });

  // The number in the cell cannot be information for sighted users only.
  it('says it in the label too, in the singular when it is one', () => {
    const one = { ...roster, people: [roster.people[0]!] };
    render(<Calendar year={2026} month={9} shifts={shifts} roster={one} selected={null} onPick={() => {}} />);
    expect(screen.getByRole('button', { name: /1 collega con te/ })).toBeInTheDocument();
  });

  it('says nothing at all when nobody overlaps', () => {
    render(<Calendar year={2026} month={9} shifts={shifts} roster={{ ...roster, people: [roster.people[2]!] }} selected={null} onPick={() => {}} />);
    expect(screen.getByRole('button', { name: /1 settembre/ })).not.toHaveTextContent('colleghi');
  });

  it('works exactly as before with no roster at all', () => {
    render(<Calendar year={2026} month={9} shifts={shifts} selected={null} onPick={() => {}} />);
    expect(screen.getByRole('button', { name: /1 settembre/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root web web/test/app.test.tsx`
Expected: FAIL — la prop non esiste, nessun conteggio è reso.

- [ ] **Step 3: Write minimal implementation**

In `app/web/src/Calendar.tsx`: `countOverlapping` fra gli import da `@vanessa/core`, `roster?: MonthRoster | null` su `CalendarProps`, e dentro la cella, dopo `const code = entry?.code;`:

```tsx
            const mates = countOverlapping(roster ?? null, d, code ?? '');
```

nell'`aria-label`, prima della parentesi di `swapped`:

```tsx
                  (mates > 0 ? `, ${mates} ${mates === 1 ? 'collega' : 'colleghi'} con te` : '') +
```

e nel corpo, dentro lo `<span className="code">`, accanto al punto degli scambi:

```tsx
                  {mates > 0 ? <span className="mates" aria-hidden="true">{mates}</span> : null}
```

`aria-hidden` sul numero perché l'`aria-label` del pulsante lo dice già a parole: letto due volte sarebbe rumore.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root web web/test/app.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add app/web/src/Calendar.tsx app/web/src/styles.css app/web/test/app.test.tsx
git commit -m "feat: il numero nella cella dice quante colleghe condividono le ore"
```

---

### Task 11: il foglio del giorno, e il caricamento al cambio mese

**Files:**
- Modify: `app/web/src/DayEditor.tsx`, `app/web/src/App.tsx`
- Test: `app/web/test/app.test.tsx`

**Interfaces:**
- Consumes: `rosterOnDay`, `RosterEntry` (Task 2), `api.roster` (Task 8).
- Produces: su `DayEditorProps`, la prop `mates: readonly RosterEntry[]`.

- [ ] **Step 1: Write the failing test**

```tsx
describe('the day sheet lists who is in', () => {
  const mates = [
    { name: 'Giulia', row: 3, code: 'P', withYou: true },
    { name: 'Anna', row: 5, code: 'M', withYou: false },
  ];

  it('splits them, and marks neither as editable', () => {
    render(<DayEditor date="2026-09-01" shift={null} colleagues={[]} mates={mates} onSave={() => {}} onDelete={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Con te')).toBeInTheDocument();
    expect(screen.getByText('Quel giorno')).toBeInTheDocument();
    expect(screen.getByText('Giulia')).toBeInTheDocument();
    // Nothing in the block is an input: the roster is read-only.
    expect(screen.getByText('Giulia').closest('input')).toBeNull();
  });

  it('says nothing when nobody is in', () => {
    render(<DayEditor date="2026-09-01" shift={null} colleagues={[]} mates={[]} onSave={() => {}} onDelete={() => {}} onClose={() => {}} />);
    expect(screen.queryByText('Quel giorno')).not.toBeInTheDocument();
  });
});

describe('App and the roster', () => {
  it('asks for the roster of the month it is showing, one month at a time', async () => {
    const asked: number[] = [];
    const api = fakeApi({ roster: async (_y: number, m: number) => { asked.push(m); return null; } });
    render(<App api={api} initialMonth={9} today="2026-09-01" />);
    await screen.findByRole('button', { name: /1 settembre/ });
    expect(asked).toEqual([9]);
  });

  it('asks again when the month changes', async () => {
    const asked: number[] = [];
    const api = fakeApi({ roster: async (_y: number, m: number) => { asked.push(m); return null; } });
    render(<App api={api} initialMonth={9} today="2026-09-01" />);
    await screen.findByRole('button', { name: /1 settembre/ });
    await userEvent.click(screen.getByRole('button', { name: /mese successivo/i }));
    await waitFor(() => expect(asked).toEqual([9, 10]));
  });

  // A roster that will not load is not a reason to lose the calendar.
  it('still shows the month when the roster call fails', async () => {
    const api = fakeApi({ roster: async () => { throw new Error('giù'); } });
    render(<App api={api} initialMonth={9} today="2026-09-01" />);
    expect(await screen.findByRole('button', { name: /1 settembre/ })).toBeInTheDocument();
  });
});
```

`fakeApi(overrides)` è l'aiutante già presente in `app.test.tsx`; aggiungergli `roster` e `saveRoster` con un default innocuo (`async () => null` e `async () => {}`), altrimenti ogni test esistente che lo usa smette di compilare.

Il pulsante di navigazione si chiama `Mese successivo` (`aria-label` in `App.tsx:224`); il precedente `Mese precedente`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root web web/test/app.test.tsx`
Expected: FAIL — `mates` non esiste, il roster non viene chiesto.

- [ ] **Step 3: Write minimal implementation**

In `app/web/src/DayEditor.tsx`, `mates: readonly RosterEntry[]` su `DayEditorProps` e, in fondo al corpo della sheet, un blocco in sola lettura:

```tsx
{mates.length > 0 && (
  <div className="mates-list">
    {mates.some((m) => m.withYou) && (
      <>
        <h3>Con te</h3>
        <ul>
          {mates.filter((m) => m.withYou).map((m, i) => (
            <li key={`${m.name}-${m.row ?? i}`}>
              <span>{m.name}</span> <span className={`t-${m.code}`}>{m.code}</span>
            </li>
          ))}
        </ul>
      </>
    )}
    {mates.some((m) => !m.withYou) && (
      <>
        <h3>Quel giorno</h3>
        <ul>
          {mates.filter((m) => !m.withYou).map((m, i) => (
            <li key={`${m.name}-${m.row ?? i}`}>
              <span>{m.name}</span> <span className={`t-${m.code}`}>{m.code}</span>
            </li>
          ))}
        </ul>
      </>
    )}
  </div>
)}
```

In `app/web/src/App.tsx`:

```tsx
  const [roster, setRoster] = useState<MonthRoster | null>(null);

  // One month at a time, unlike her shifts which load for the year: twelve
  // months of grid is a large payload for something only ever looked at a
  // month at a time.
  useEffect(() => {
    let alive = true;
    api
      .roster(YEAR, month)
      .then((r) => alive && setRoster(r))
      // A roster that will not load is not a reason to lose the calendar.
      .catch(() => alive && setRoster(null));
    return () => {
      alive = false;
    };
  }, [api, month]);
```

`roster={roster}` su `<Calendar>`; su `<DayEditor>`:

```tsx
mates={rosterOnDay(roster, editing, days.get(editing)?.code ?? '')}
```

e `onSaveRoster` su `<BulkEntry>` diventa un handler che salva e poi ricarica il mese corrente, così il calendario mostra subito quello che è appena stato importato:

```tsx
  const saveRoster = useCallback(
    async (r: MonthRoster) => {
      await api.saveRoster(r);
      if (r.month === month) setRoster(r);
    },
    [api, month],
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root web web/test/app.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add app/web/src/DayEditor.tsx app/web/src/App.tsx app/web/src/styles.css app/web/test/app.test.tsx
git commit -m "feat: chi c'e' quel giorno, nel foglio del giorno"
```

---

### Task 12: la documentazione

**Files:**
- Modify: `app/README.md`

**Interfaces:**
- Consumes: tutto quanto sopra. Produces: niente.

- [ ] **Step 1: Write the section**

In `app/README.md`, dentro `## Import da foto`, una sottosezione nuova:

````markdown
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
````

E in `## Modello dati`, la riga della chiave nuova:

```
ROSTER#<anno> / <MM>   — il turnario del mese: una riga per persona, le sigle unite da virgole
```

- [ ] **Step 2: Check the whole suite is still green**

Run: `npm test && npm run typecheck`
Expected: verde. Nessun codice è cambiato.

- [ ] **Step 3: Commit**

```bash
git add app/README.md
git commit -m "docs: i turni degli altri, e perché una sigla ignota non si indovina"
```

---

## Ordine e dipendenze

I task 1→3 (`core`) sono la base di tutto. 4, 5 e 6 dipendono da 1; 7 da 6; 8 da 6; 9 da 8 e da 3; 10 da 2; 11 da 2, 8, 9 e 10. Il 12 è ultimo.

Fra 1 e 3 non c'è nulla di parallelizzabile: toccano lo stesso file. 4, 5 e 8 invece non si toccano fra loro.

## Come si verifica alla fine

Dalla cartella `app/`:

```bash
npm test && npm run typecheck
```

E la prova che nessuna delle due regole è stata mescolata all'altra:

```bash
git log --oneline main..HEAD    # dodici commit, uno per task
git diff main -- app/core/src/photo.ts   # solo READING_SCHEMA: validateReading non è cambiata
```
