# Import dei turni da una foto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vanessa fotografa il foglio dei turni, l'app legge la sua riga e le presenta un mese già compilato da correggere e salvare.

**Architecture:** Una Lambda nuova dietro una Function URL riceve l'immagine, consuma una quota giornaliera su DynamoDB, chiede a Claude Opus 5 su Bedrock di leggere la riga e restituisce l'estrazione — senza mai scrivere un turno. `core` giudica la forma di quello che il modello ha detto; il frontend mostra una griglia modificabile e salva con la rotta `PUT /shifts` che esiste già, revisione compresa.

**Tech Stack:** TypeScript ovunque. `@anthropic-ai/bedrock-sdk` (`AnthropicBedrockMantle`), `anthropic.claude-opus-5` in `eu-south-1`, DynamoDB, CDK, React 19 + Vite, vitest.

Spec: `docs/superpowers/specs/2026-08-02-import-turni-da-foto-design.md`.

## Global Constraints

- **Il testo che finisce a schermo è in italiano.** Commenti e identificatori del codice in inglese, come nel resto del repository. Gli identificatori dei construct CDK restano in italiano: rinominarli distrugge la risorsa.
- **`core` non importa nulla da AWS e non conosce HTTP.** È condiviso fra `api` e `web`.
- **L'endpoint di lettura non scrive mai un turno.** L'unica scrittura è il contatore della quota.
- **I giorni senza codice non cancellano nulla.** Mai un `deleteShift` da un'estrazione.
- **Le due foto non entrano nel repository** (`hpfs74/vanessa-shift` è pubblico e le foto contengono i dati di quattordici colleghe). Il test di integrazione le legge da `FOTO_LUGLIO` e `FOTO_AGOSTO` e si salta se mancano.
- Modello: `anthropic.claude-opus-5`. Regione: `eu-south-1`. Tetto: **10 letture al giorno**. Corpo massimo: **2 MB**. Lato lungo dell'immagine: **2576 px**.
- Ogni task finisce con `npm test` e `npm run typecheck` verdi dalla cartella `app/`.

## Struttura dei file

| File | Responsabilità |
|------|----------------|
| `app/core/src/photo.ts` (nuovo) | Tipi dell'estrazione, schema JSON per il modello, validazione, conversione in `ParsedEntry[]`. Puro. |
| `app/core/src/dates.ts` (modificato) | `romeToday()`: la data civile italiana, per la chiave della quota. |
| `app/core/src/index.ts` (modificato) | Riesporta `photo.js`. |
| `app/api/src/repo.ts` (modificato) | `consumePhotoQuota()`: contatore atomico giornaliero. |
| `app/api/src/vision.ts` (nuovo) | La chiamata a Bedrock: prompt, immagine, schema, lettura della risposta. |
| `app/api/src/http.ts` (modificato) | `requireImage()` e la costante del corpo massimo. |
| `app/api/src/handlers.ts` (modificato) | `readPhoto`: dimensione → quota → visione → validazione. |
| `app/infra/lib/app-stack.ts` (modificato) | Lambda `ReadPhoto`, Function URL, permesso Bedrock, TTL sulla tabella. |
| `app/web/src/image.ts` (nuovo) | Ridimensionamento su canvas. |
| `app/web/src/api.ts` (modificato) | `readPhoto()` verso la Function URL. |
| `app/web/src/SavePlan.tsx` (nuovo) | Estratto da `BulkEntry`: riepilogo, tabella delle sovrascritture, pulsante. Condiviso fra testo e foto. |
| `app/web/src/BulkEntry.tsx` (modificato) | Tiene la textarea, delega il resto, ospita il percorso foto. |
| `app/web/src/PhotoImport.tsx` (nuovo) | Scelta della foto, stato della lettura, griglia modificabile. |
| `app/web/src/App.tsx` (modificato) | Passa `api.readPhoto` a `BulkEntry`. |

---

### Task 1: `core/src/photo.ts` — il contratto e il suo giudice

Il pezzo che decide se quello che il modello ha detto è utilizzabile. Puro, senza rete: è il posto dove si testano tutti i modi in cui un'estrazione può essere sbagliata.

**Files:**
- Create: `app/core/src/photo.ts`
- Create: `app/core/test/photo.test.ts`
- Modify: `app/core/src/index.ts`
- Modify: `app/core/src/dates.ts` (aggiunta di `romeToday`)

**Interfaces:**
- Consumes: `ShiftCode`, `isShiftCode` da `./shifts.js`; `IsoDate`, `daysInMonth`, `toIso` da `./dates.js`; `ParsedEntry` da `./bulk.js`.
- Produces:
  - `ROW_NAME: string` (`'Vanessa'`), `MAX_READINGS_PER_DAY: number` (`10`)
  - `interface ReadDay { day: number; code: ShiftCode | null; confident: boolean }`
  - `interface PhotoReading { month: number; year: number; found: boolean; foundName: string | null; foundRow: number | null; days: ReadDay[] }`
  - `READING_SCHEMA: Record<string, unknown>`
  - `class InvalidReading extends Error`, `class RowNotFound extends Error`
  - `validateReading(v: unknown, expectedYear: number): PhotoReading`
  - `entriesFromReading(e: PhotoReading): ParsedEntry[]`
  - `romeToday(now?: Date): IsoDate` (da `dates.js`)

- [ ] **Step 1: Scrivi i test che falliscono**

Crea `app/core/test/photo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  InvalidReading,
  RowNotFound,
  romeToday,
  validateReading,
  entriesFromReading,
} from '../src/index.js';

/** A well-formed reading of `days` days, all without a shift. */
function emptyReading(month: number, year: number, days: number) {
  return {
    month,
    year,
    found: true,
    foundName: 'Vanessa',
    foundRow: 14,
    days: Array.from({ length: days }, (_, i) => ({
      day: i + 1,
      code: null,
      confident: true,
    })),
  };
}

/** July as it stands on the photo: x until the 16th, then fifteen shifts. */
const JULY_CODES = ['M','M','P','L','P','M','M','M','L','P','M','M','M','L','P'] as const;

function julyReading() {
  const e = emptyReading(7, 2026, 31);
  JULY_CODES.forEach((code, i) => {
    e.days[16 + i] = { day: 17 + i, code, confident: true } as never;
  });
  return e;
}

describe('validateReading', () => {
  it('accepts a well-formed whole month', () => {
    const e = validateReading(emptyReading(8, 2026, 31), 2026);
    expect(e.month).toBe(8);
    expect(e.days).toHaveLength(31);
  });

  it('accepts the year before and after, not a far one', () => {
    expect(() => validateReading(emptyReading(8, 2025, 31), 2026)).not.toThrow();
    expect(() => validateReading(emptyReading(8, 2027, 31), 2026)).not.toThrow();
    expect(() => validateReading(emptyReading(8, 2019, 31), 2026)).toThrow(InvalidReading);
  });

  it('rejects a month out of range', () => {
    expect(() => validateReading({ ...emptyReading(1, 2026, 31), month: 13 }, 2026)).toThrow(
      InvalidReading,
    );
  });

  it('wants exactly the days of the month: February 2026 has 28', () => {
    expect(() => validateReading(emptyReading(2, 2026, 28), 2026)).not.toThrow();
    expect(() => validateReading(emptyReading(2, 2026, 29), 2026)).toThrow(InvalidReading);
  });

  it('rejects a missing day', () => {
    const e = emptyReading(8, 2026, 31);
    e.days.splice(10, 1);
    expect(() => validateReading(e, 2026)).toThrow(InvalidReading);
  });

  it('rejects a duplicate day', () => {
    const e = emptyReading(8, 2026, 31);
    e.days[11] = { day: 11, code: null, confident: true };
    expect(() => validateReading(e, 2026)).toThrow(InvalidReading);
  });

  it('rejects a day outside the month', () => {
    const e = emptyReading(8, 2026, 31);
    e.days[30] = { day: 32, code: null, confident: true };
    expect(() => validateReading(e, 2026)).toThrow(InvalidReading);
  });

  it('rejects a code that does not exist', () => {
    const e = emptyReading(8, 2026, 31);
    e.days[0] = { day: 1, code: 'P2' as never, confident: true };
    expect(() => validateReading(e, 2026)).toThrow(InvalidReading);
  });

  it('rejects something that is not even an object', () => {
    expect(() => validateReading('ciao', 2026)).toThrow(InvalidReading);
    expect(() => validateReading(null, 2026)).toThrow(InvalidReading);
    expect(() => validateReading([], 2026)).toThrow(InvalidReading);
  });

  it('when the row is not there it says so with its own error', () => {
    const e = { ...emptyReading(8, 2026, 31), found: false, foundName: null, foundRow: null };
    expect(() => validateReading(e, 2026)).toThrow(RowNotFound);
  });
});

describe('entriesFromReading', () => {
  it('skips days without a code: July starts on the 17th', () => {
    const entries = entriesFromReading(validateReading(julyReading(), 2026));
    expect(entries).toHaveLength(15);
    expect(entries[0]).toEqual({ date: '2026-07-17', day: 17, code: 'M' });
    expect(entries[14]).toEqual({ date: '2026-07-31', day: 31, code: 'P' });
  });

  it('a month with nothing produces no entries', () => {
    expect(entriesFromReading(validateReading(emptyReading(8, 2026, 31), 2026))).toEqual([]);
  });
});

describe('romeToday', () => {
  it('is the Italian civil date, not the UTC one', () => {
    // Half past midnight in Rome in summer: in Greenwich it's still the day before.
    expect(romeToday(new Date('2026-08-02T22:30:00Z'))).toBe('2026-08-03');
    expect(romeToday(new Date('2026-08-02T12:00:00Z'))).toBe('2026-08-02');
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `cd app && npx vitest run --root core core/test/photo.test.ts`
Expected: FAIL — `validateReading` non è esportata da `../src/index.js`.

- [ ] **Step 3: Aggiungi `romeToday` a `core/src/dates.ts`**

In fondo a `app/core/src/dates.ts`, subito dopo `today()`:

```ts
/** The Italian civil date.
 *
 * The Lambda runs in UTC, where the day changes at one or two in the morning
 * Italian time: a daily counter hung on UTC would reset while here it is
 * still yesterday. 'sv-SE' is the shortcut for getting YYYY-MM-DD. */
export function romeToday(now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(now);
}
```

- [ ] **Step 4: Scrivi `core/src/photo.ts`**

```ts
/** Import da una foto del foglio dei turni.
 *
 * Here no image is read: here it is decided whether what the model said it
 * read is usable. A half-plausible grid is worse than an error, because it
 * gets saved without anyone noticing: validation is therefore all-or-nothing.
 */

import { type IsoDate, daysInMonth, toIso } from './dates.js';
import type { ParsedEntry } from './bulk.js';
import { type ShiftCode, SHIFTS, isShiftCode } from './shifts.js';

/** The row to look for on the sheet. */
export const ROW_NAME = 'Vanessa';

/** The API is open and every reading costs money: the cap is the main defense. */
export const MAX_READINGS_PER_DAY = 10;

export interface ReadDay {
  readonly day: number;
  /** null means "the sheet has no shift here": an x, an empty cell,
   *  or an unreadable cell. For saving purposes they're the same thing. */
  readonly code: ShiftCode | null;
  /** The model's suggestion, not a verdict: it is used to underline the cell.
   *  Every cell stays editable. */
  readonly confident: boolean;
}

export interface PhotoReading {
  readonly month: number;
  readonly year: number;
  readonly found: boolean;
  readonly foundName: string | null;
  readonly foundRow: number | null;
  readonly days: readonly ReadDay[];
}

/** The shape the model is required to return.
 *
 * No numeric min/max: structured outputs don't enforce them, and the judge is
 * validateReading anyway, not the schema. */
export const READING_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    month: { type: 'integer' },
    year: { type: 'integer' },
    found: { type: 'boolean' },
    foundName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    foundRow: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'integer' },
          code: {
            anyOf: [{ type: 'string', enum: SHIFTS.map((s) => s.code) }, { type: 'null' }],
          },
          confident: { type: 'boolean' },
        },
        required: ['day', 'code', 'confident'],
        additionalProperties: false,
      },
    },
  },
  required: ['month', 'year', 'found', 'foundName', 'foundRow', 'days'],
  additionalProperties: false,
};

/** The reading cannot be used. */
export class InvalidReading extends Error {}

/** The row being looked for is not in the photo: it's a separate case, because
 *  the remedy suggested is different (take the photo again, not rewrite). */
export class RowNotFound extends Error {}

function integer(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new InvalidReading(`${field}: expected an integer`);
  }
  return v;
}

export function validateReading(v: unknown, expectedYear: number): PhotoReading {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new InvalidReading('reading: expected an object');
  }
  const e = v as Record<string, unknown>;

  if (e.found !== true) throw new RowNotFound(`riga di ${ROW_NAME} non trovata`);

  const month = integer(e.month, 'mese');
  if (month < 1 || month > 12) throw new InvalidReading('month: out of 1-12');

  const year = integer(e.year, 'anno');
  if (Math.abs(year - expectedYear) > 1) throw new InvalidReading('year: too far off');

  if (typeof e.foundName !== 'string' || e.foundName.length === 0) {
    throw new InvalidReading('foundName: expected a name');
  }
  const foundRow = integer(e.foundRow, 'rigaTrovata');

  if (!Array.isArray(e.days)) throw new InvalidReading('days: expected an array');
  const expected = daysInMonth(year, month);
  if (e.days.length !== expected) {
    throw new InvalidReading(`days: expected ${expected}, got ${e.days.length}`);
  }

  const seen = new Set<number>();
  const days: ReadDay[] = e.days.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new InvalidReading(`days[${i}]: expected an object`);
    }
    const g = raw as Record<string, unknown>;
    const day = integer(g.day, `days[${i}].day`);
    if (day < 1 || day > expected) {
      throw new InvalidReading(`days[${i}].day: ${day} not in the month`);
    }
    // The same day twice would mean that one column was read twice and
    // another never: the grid is not aligned.
    if (seen.has(day)) throw new InvalidReading(`day ${day} appears twice`);
    seen.add(day);

    const code = g.code;
    if (code !== null && !isShiftCode(code)) {
      throw new InvalidReading(`days[${i}].code: unknown shift code`);
    }
    if (typeof g.confident !== 'boolean') {
      throw new InvalidReading(`days[${i}].confident: expected a boolean`);
    }
    return { day, code: code as ShiftCode | null, confident: g.confident };
  });

  return { month, year, found: true, foundName: e.foundName, foundRow, days };
}

/** Only the days with a shift. The others are not saved and don't delete
 *  anything: a photo can be cropped, and deleting has no undo. */
export function entriesFromReading(e: PhotoReading): ParsedEntry[] {
  const out: ParsedEntry[] = [];
  for (const g of e.days) {
    if (g.code === null) continue;
    out.push({ date: toIso(e.year, e.month, g.day), day: g.day, code: g.code });
  }
  return out;
}

export type { IsoDate };
```

- [ ] **Step 5: Riesporta da `core/src/index.ts`**

Aggiungi in fondo:

```ts
export * from './photo.js';
```

- [ ] **Step 6: Esegui i test e verifica che passino**

Run: `cd app && npm test && npm run typecheck`
Expected: PASS, compresi i test già esistenti di `core`.

- [ ] **Step 7: Commit**

```bash
git add app/core/src/photo.ts app/core/src/dates.ts app/core/src/index.ts app/core/test/photo.test.ts
git commit -m "feat: il contratto dell'estrazione da foto, e il suo giudice"
```

---

### Task 2: la quota giornaliera

Un contatore atomico. Il punto delicato è che due richieste simultanee al confine non devono passare entrambe, quindi la condizione e l'incremento sono la stessa operazione.

**Files:**
- Modify: `app/api/src/repo.ts`
- Create: `app/api/test/repo.test.ts`

**Interfaces:**
- Consumes: `MAX_READINGS_PER_DAY` da `@vanessa/core`.
- Produces: sull'interfaccia `Repo`, `consumePhotoQuota(date: IsoDate, max: number): Promise<boolean>` — `true` se la lettura è concessa, `false` se il tetto è già stato raggiunto. Costante esportata `QUOTA_PK = 'QUOTA#FOTO'`.

- [ ] **Step 1: Scrivi i test che falliscono**

Crea `app/api/test/repo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { QUOTA_PK, createRepo } from '../src/repo.js';

/** Fake DynamoDB, with only the semantics we care about: ADD on a number,
 *  and a condition evaluated on the item as it was before the update. */
function fakeDoc(max: number) {
  const counts = new Map<string, number>();
  const doc = {
    async send(cmd: { input: Record<string, any> }) {
      const key = String(cmd.input.Key.sk);
      const current = counts.get(key) ?? 0;
      const limit = Number(cmd.input.ExpressionAttributeValues[':max']);
      if (counts.has(key) && current >= limit) {
        const e = new Error('condizione fallita');
        e.name = 'ConditionalCheckFailedException';
        throw e;
      }
      counts.set(key, current + 1);
      return {};
    },
  };
  return { doc: doc as unknown as DynamoDBDocumentClient, counts, max };
}

describe('consumePhotoQuota', () => {
  it('grants readings up to the cap and no further', async () => {
    const { doc, counts } = fakeDoc(3);
    const repo = createRepo('tabella', doc);

    expect(await repo.consumePhotoQuota('2026-08-02', 3)).toBe(true);
    expect(await repo.consumePhotoQuota('2026-08-02', 3)).toBe(true);
    expect(await repo.consumePhotoQuota('2026-08-02', 3)).toBe(true);
    expect(await repo.consumePhotoQuota('2026-08-02', 3)).toBe(false);
    expect(counts.get('2026-08-02')).toBe(3);
  });

  it('starts over at zero the next day', async () => {
    const { doc } = fakeDoc(1);
    const repo = createRepo('tabella', doc);

    expect(await repo.consumePhotoQuota('2026-08-02', 1)).toBe(true);
    expect(await repo.consumePhotoQuota('2026-08-02', 1)).toBe(false);
    expect(await repo.consumePhotoQuota('2026-08-03', 1)).toBe(true);
  });

  it('writes under the quota key, not among the shifts', async () => {
    const keys: Record<string, unknown>[] = [];
    const doc = {
      async send(cmd: { input: Record<string, any> }) {
        keys.push(cmd.input.Key);
        return {};
      },
    } as unknown as DynamoDBDocumentClient;

    await createRepo('tabella', doc).consumePhotoQuota('2026-08-02', 10);
    expect(keys[0]).toEqual({ pk: QUOTA_PK, sk: '2026-08-02' });
  });

  it('an error that is not the condition propagates, it does not become a silent no', async () => {
    const doc = {
      async send() {
        throw new Error('rete');
      },
    } as unknown as DynamoDBDocumentClient;

    await expect(createRepo('tabella', doc).consumePhotoQuota('2026-08-02', 10)).rejects.toThrow(
      'rete',
    );
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `cd app && npx vitest run --root api api/test/repo.test.ts`
Expected: FAIL — `QUOTA_PK` non esiste e `consumePhotoQuota` non è sul `Repo`.

- [ ] **Step 3: Implementa in `api/src/repo.ts`**

Aggiungi `UpdateCommand` all'import da `@aws-sdk/lib-dynamodb`:

```ts
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
```

Sotto `CONFIG_SK`, aggiungi:

```ts
/** The counter of photo readings, one row per day. */
export const QUOTA_PK = 'QUOTA#FOTO';

/** How long a count row survives past its day. Two days are enough to cover
 *  any timezone and keep the table clean. */
const QUOTA_TTL_DAYS = 2;
```

Nell'interfaccia `Repo`, dopo `savePaySettings`:

```ts
  /** Consumes a photo reading for that day. `false` if the cap has already
   *  been reached. The condition and the increment are the same operation:
   *  two simultaneous requests at the boundary must not both go through. */
  consumePhotoQuota(date: IsoDate, max: number): Promise<boolean>;
```

E nell'oggetto restituito da `createRepo`, dopo `savePaySettings`:

```ts
    async consumePhotoQuota(date, max) {
      const { year, month, day } = parseIso(date);
      const expires = Math.floor(Date.UTC(year, month - 1, day + QUOTA_TTL_DAYS) / 1000);
      try {
        await doc.send(
          new UpdateCommand({
            TableName: table,
            Key: { pk: QUOTA_PK, sk: date },
            UpdateExpression: 'SET expires = :expires ADD count :one',
            ConditionExpression: 'attribute_not_exists(count) OR count < :max',
            ExpressionAttributeValues: { ':one': 1, ':max': max, ':expires': expires },
          }),
        );
        return true;
      } catch (e) {
        // The failed condition is a response, not a fault: the cap has been
        // reached. Any other error must propagate.
        if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return false;
        throw e;
      }
    },
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `cd app && npx vitest run --root api api/test/repo.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Aggiorna il repo finto dei test degli handler**

In `app/api/test/handlers.test.ts`, dentro `fakeRepo()`, aggiungi al `Repo` — subito dopo `savePaySettings` — il metodo mancante, altrimenti non compila:

```ts
    async consumePhotoQuota(date, max) {
      calls.push(`consumePhotoQuota(${date},${max})`);
      const used = (quota.get(date) ?? 0) + 1;
      if (used > max) return false;
      quota.set(date, used);
      return true;
    },
```

e dichiara `const quota = new Map<string, number>();` accanto a `const shifts = ...`, aggiungendo `quota` all'oggetto restituito da `fakeRepo`.

- [ ] **Step 6: Esegui tutti i test**

Run: `cd app && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/src/repo.ts app/api/test/repo.test.ts app/api/test/handlers.test.ts
git commit -m "feat: tetto giornaliero alle letture da foto, atomico"
```

---

### Task 3: `api/src/vision.ts` — la chiamata a Bedrock

L'unico pezzo che parla col modello. Non giudica niente: restituisce quello che ha ricevuto, e lascia giudicare a `core`.

**Files:**
- Create: `app/api/src/vision.ts`
- Create: `app/api/test/vision.test.ts`
- Modify: `app/api/package.json`

**Interfaces:**
- Consumes: `ROW_NAME`, `READING_SCHEMA` da `@vanessa/core`.
- Produces:
  - `type Vision = (immagineBase64: string) => Promise<unknown>`
  - `MODEL = 'anthropic.claude-opus-5'`
  - `class VisionFailed extends Error`
  - `createVision(client?: MessagesClient): Vision`
  - `interface MessagesClient { messages: { create(body: unknown): Promise<MessagesResponse> } }` — il minimo che serve, così i test non montano l'SDK
  - `interface MessagesResponse { stop_reason?: string | null; content: { type: string; text?: string }[] }`

- [ ] **Step 1: Aggiungi la dipendenza**

```bash
cd app && npm install --workspace @vanessa/api @anthropic-ai/bedrock-sdk
```

- [ ] **Step 2: Scrivi i test che falliscono**

Crea `app/api/test/vision.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { ROW_NAME } from '@vanessa/core';

import { MODEL, VisionFailed, createVision } from '../src/vision.js';

function clientReturning(risposta: unknown) {
  const sent: any[] = [];
  const client = {
    messages: {
      async create(body: unknown) {
        sent.push(body);
        return risposta as never;
      },
    },
  };
  return { client, sent };
}

const GOOD_RESPONSE = {
  stop_reason: 'end_turn',
  content: [
    { type: 'thinking', thinking: '' },
    { type: 'text', text: '{"mese":8,"anno":2026,"trovata":true}' },
  ],
};

describe('createVision', () => {
  it('returns the JSON of the text block, already deserialized', async () => {
    const { client } = clientReturning(GOOD_RESPONSE);
    const out = await createVision(client)('AAAA');
    expect(out).toEqual({ mese: 8, anno: 2026, trovata: true });
  });

  it('sends image, model, schema and the row name', async () => {
    const { client, sent } = clientReturning(GOOD_RESPONSE);
    await createVision(client)('AAAA');

    const b = sent[0];
    expect(b.model).toBe(MODEL);
    expect(b.output_config.format.type).toBe('json_schema');

    const blocks = b.messages[0].content;
    const image = blocks.find((c: any) => c.type === 'image');
    expect(image.source).toEqual({
      type: 'base64',
      media_type: 'image/jpeg',
      data: 'AAAA',
    });
    const text = blocks.find((c: any) => c.type === 'text').text;
    expect(text).toContain(ROW_NAME);
  });

  it('skips the reasoning blocks and takes the text', async () => {
    const { client } = clientReturning({
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":1}' }],
    });
    expect(await createVision(client)('AAAA')).toEqual({ a: 1 });
  });

  it('a refusal from the model is not JSON to read', async () => {
    const { client } = clientReturning({ stop_reason: 'refusal', content: [] });
    await expect(createVision(client)('AAAA')).rejects.toThrow(VisionFailed);
  });

  it('a truncated response is not JSON to read', async () => {
    const { client } = clientReturning({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"mese":8' }],
    });
    await expect(createVision(client)('AAAA')).rejects.toThrow(VisionFailed);
  });

  it('no text block is an error, not an undefined that travels on', async () => {
    const { client } = clientReturning({ stop_reason: 'end_turn', content: [] });
    await expect(createVision(client)('AAAA')).rejects.toThrow(VisionFailed);
  });

  it('text that is not JSON is an error', async () => {
    const { client } = clientReturning({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'mi dispiace' }],
    });
    await expect(createVision(client)('AAAA')).rejects.toThrow(VisionFailed);
  });
});
```

- [ ] **Step 3: Esegui i test e verifica che falliscano**

Run: `cd app && npx vitest run --root api api/test/vision.test.ts`
Expected: FAIL — `../src/vision.js` non esiste.

- [ ] **Step 4: Scrivi `api/src/vision.ts`**

```ts
/** The photo reading: the only point that talks to the model.
 *
 * It doesn't judge anything. It returns what it received, already
 * deserialized, and leaves it to `core` to say whether it's usable: the
 * judgment is domain logic, and must be testable without a network.
 *
 * The prompt is in Italian like the sheet it describes: the codes, the month
 * names and the word "turno" (shift) are the document's own vocabulary.
 */

import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';

import { ROW_NAME, READING_SCHEMA, SHIFTS } from '@vanessa/core';

export const MODEL = 'anthropic.claude-opus-5';
export const REGION = process.env.AWS_REGION ?? 'eu-south-1';

/** The minimum the client needs, so the tests don't pull in the SDK. */
export interface MessagesResponse {
  stop_reason?: string | null;
  content: { type: string; text?: string }[];
}
export interface MessagesClient {
  messages: { create(body: unknown): Promise<MessagesResponse> };
}

export type Vision = (immagineBase64: string) => Promise<unknown>;

/** The reading didn't succeed. The caller translates it into a message. */
export class VisionFailed extends Error {}

const CODES = SHIFTS.map((s) => s.code).join(', ');

const PROMPT = `Questa foto e' il foglio dei turni mensile di una struttura sanitaria.

E' una griglia: ogni riga e' una persona, ogni colonna e' un giorno del mese.
Sopra le colonne c'e' una riga con i numeri dei giorni, da 1 fino alla fine del
mese: usala per allineare le colonne, non contarle a occhio. In alto c'e' il
titolo con il mese e l'anno.

Devi leggere UNA SOLA riga: quella della persona di nome ${ROW_NAME}.
I nomi stanno a sinistra, su due righe (cognome sopra, nome sotto): la riga dei
turni e' quella del nome.

Per ogni giorno del mese riporta la sigla che sta nella cella di quella riga.
Le sigle valide sono soltanto: ${CODES}.
Se la cella contiene una x, e' vuota, oppure non riesci a leggerla con
ragionevole certezza, metti codice null.

Attenzione: le altre righe contengono anche sigle diverse (F, R, C, N1 e altre).
Non riguardano questa persona. Non riportare mai la cella di un'altra riga.

Riporta un elemento per OGNI giorno del mese, dal primo all'ultimo, anche per i
giorni con codice null. Metti sicuro a false quando la cella e' sbiadita,
corretta a mano, ambigua o coperta.

Se nella foto non c'e' nessuna riga intestata a ${ROW_NAME}, metti trovata a
false e giorni a un elenco vuoto.`;

/** Reasoning on Claude Opus 5 is on by default, and that's what's needed:
 *  counting thirty-one crooked, handwritten columns isn't a glance. The token
 *  cap covers reasoning plus response together, so it's set generous: too
 *  tight, and it truncates halfway. */
const MAX_TOKENS = 8000;

export function createVision(client?: MessagesClient): Vision {
  const c: MessagesClient =
    client ?? (new AnthropicBedrockMantle({ awsRegion: REGION }) as unknown as MessagesClient);

  return async (immagineBase64: string) => {
    const response = await c.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { format: { type: 'json_schema', schema: READING_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: immagineBase64 },
            },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });

    // Classifiers can refuse: that's a 200 with empty content, not an HTTP
    // error. Reading content[0] here would give an undefined that travels on.
    if (response.stop_reason === 'refusal') {
      throw new VisionFailed('il modello ha rifiutato la richiesta');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new VisionFailed('risposta troncata');
    }

    const text = response.content.find((b) => b.type === 'text')?.text;
    if (!text) throw new VisionFailed('nessun blocco di testo nella risposta');

    try {
      return JSON.parse(text);
    } catch {
      throw new VisionFailed('la risposta non e JSON');
    }
  };
}
```

- [ ] **Step 5: Esegui i test e verifica che passino**

Run: `cd app && npx vitest run --root api api/test/vision.test.ts`
Expected: PASS (7 test).

- [ ] **Step 6: Commit**

```bash
git add app/api/src/vision.ts app/api/test/vision.test.ts app/api/package.json app/package-lock.json
git commit -m "feat: la lettura della foto con Claude Opus 5 su Bedrock"
```

---

### Task 4: l'handler `readPhoto`

Cuce insieme i tre pezzi nell'ordine che conta: prima si rifiuta quello che è troppo grande (senza spendere), poi si consuma la quota, poi si spende.

**Files:**
- Modify: `app/api/src/http.ts`
- Modify: `app/api/src/handlers.ts`
- Modify: `app/api/test/handlers.test.ts`

**Interfaces:**
- Consumes: `Repo.consumePhotoQuota` (Task 2), `Vision` e `VisionFailed` (Task 3), `validateReading`, `InvalidReading`, `RowNotFound`, `MAX_READINGS_PER_DAY`, `romeToday` (Task 1).
- Produces: `MAX_BODY_BYTES` e `requireImage(v: unknown): string` da `http.js`; `readPhotoWith(repo: Repo, vision: Vision, today?: () => IsoDate, year?: () => number)` e l'entry point `readPhoto` da `handlers.js`.

- [ ] **Step 1: Scrivi i test che falliscono**

In fondo a `app/api/test/handlers.test.ts` aggiungi:

```ts
import { readPhotoWith } from '../src/handlers.js';
import { VisionFailed } from '../src/vision.js';

/** A valid August reading, with a single shift on the first of the month. */
function augustReading() {
  return {
    month: 8,
    year: 2026,
    found: true,
    foundName: 'Vanessa',
    foundRow: 12,
    days: Array.from({ length: 31 }, (_, i) => ({
      day: i + 1,
      code: i === 0 ? 'L' : null,
      confident: true,
    })),
  };
}

function photoEvent(image: string) {
  return event({ body: JSON.stringify({ image }) });
}

describe('readPhoto', () => {
  const today = () => '2026-08-02';
  const year = () => 2026;

  it('reads the photo and returns the reading', async () => {
    const { repo } = fakeRepo();
    const h = readPhotoWith(repo, async () => augustReading(), today, year);

    const r: any = await h(photoEvent('AAAA'));
    expect(r.statusCode).toBe(200);
    expect(body(r).reading.days).toHaveLength(31);
    expect(body(r).reading.month).toBe(8);
  });

  it('writes no shift', async () => {
    const { repo, shifts } = fakeRepo();
    const h = readPhotoWith(repo, async () => augustReading(), today, year);

    await h(photoEvent('AAAA'));
    expect(shifts.size).toBe(0);
  });

  it('past the cap it responds 429 without calling the model', async () => {
    const { repo } = fakeRepo();
    let calls = 0;
    const h = readPhotoWith(
      repo,
      async () => {
        calls += 1;
        return augustReading();
      },
      today,
      year,
    );

    for (let i = 0; i < 10; i++) {
      const allowed: any = await h(photoEvent('AAAA'));
      expect(allowed.statusCode).toBe(200);
    }
    const r: any = await h(photoEvent('AAAA'));
    expect(r.statusCode).toBe(429);
    expect(calls).toBe(10);
  });

  it('an oversized body is 413, touching neither quota nor model', async () => {
    const { repo, calls } = fakeRepo();
    let readCalls = 0;
    const h = readPhotoWith(
      repo,
      async () => {
        readCalls += 1;
        return augustReading();
      },
      today,
      year,
    );

    const r: any = await h(photoEvent('A'.repeat(2 * 1024 * 1024 + 1)));
    expect(r.statusCode).toBe(413);
    expect(readCalls).toBe(0);
    expect(calls.filter((c) => c.startsWith('consumePhotoQuota'))).toEqual([]);
  });

  it('when the model fails the quota stays spent', async () => {
    const { repo, quota } = fakeRepo();
    const h = readPhotoWith(
      repo,
      async () => {
        throw new VisionFailed('boom');
      },
      today,
      year,
    );

    const r: any = await h(photoEvent('AAAA'));
    expect(r.statusCode).toBe(502);
    // Otherwise anyone abusing it gets free attempts by making the reading fail.
    expect(quota.get('2026-08-02')).toBe(1);
  });

  it('a reading that fails validation is 422, not 500', async () => {
    const { repo } = fakeRepo();
    const h = readPhotoWith(repo, async () => ({ month: 99 }), today, year);

    const r: any = await h(photoEvent('AAAA'));
    expect(r.statusCode).toBe(422);
    expect(body(r).errore).toContain('leggere');
  });

  it('row not found has its own message', async () => {
    const { repo } = fakeRepo();
    const h = readPhotoWith(
      repo,
      async () => ({ ...augustReading(), found: false, foundName: null, foundRow: null }),
      today,
      year,
    );

    const r: any = await h(photoEvent('AAAA'));
    expect(r.statusCode).toBe(422);
    expect(body(r).errore).toContain('Vanessa');
  });

  it('without an image it is 400', async () => {
    const { repo } = fakeRepo();
    const h = readPhotoWith(repo, async () => augustReading(), today, year);

    const r: any = await h(event({ body: JSON.stringify({}) }));
    expect(r.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `cd app && npx vitest run --root api api/test/handlers.test.ts`
Expected: FAIL — `readPhotoWith` non è esportata.

- [ ] **Step 3: Aggiungi `requireImage` a `api/src/http.ts`**

In fondo, prima di `handle`:

```ts
/** Two megabytes. A properly resized image weighs less than one: past this
 *  threshold there's nothing to read, only money to spend. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** The body is too large: 413, and the request stops before it costs anything. */
export class TooLarge extends Error {}

export function requireImage(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new InvalidInput('immagine: attesa l immagine in base64');
  }
  // The base64 length is an over-estimate of the bytes: that's fine, the
  // check is meant to stop the huge, not to measure the exact.
  if (v.length > MAX_BODY_BYTES) throw new TooLarge('immagine troppo grande');
  return v;
}
```

E in `handle`, aggiungi il ramo prima di quello di `InvalidInput`:

```ts
export function handle(
  fn: () => Promise<APIGatewayProxyResultV2>,
): Promise<APIGatewayProxyResultV2> {
  return fn().catch((e: unknown) => {
    if (e instanceof TooLarge) return failure(413, e.message);
    if (e instanceof InvalidInput) return failure(400, e.message);
    console.error('unhandled error', e);
    return failure(500, 'errore interno');
  });
}
```

Aggiorna anche `HEADERS`, che oggi dichiara solo `GET,PUT,OPTIONS`:

```ts
  'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
```

- [ ] **Step 4: Scrivi l'handler in `api/src/handlers.ts`**

Aggiungi agli import:

```ts
import {
  InvalidReading,
  MAX_READINGS_PER_DAY,
  RowNotFound,
  romeToday,
  validateReading,
} from '@vanessa/core';
import type { IsoDate } from '@vanessa/core';

import type { Vision } from './vision.js';
import { VisionFailed, createVision } from './vision.js';
```

e a quelli da `./http.js`: `failure`, `requireImage`.

Poi, dopo `putConfigWith`:

```ts
/** Reads a photo of the sheet and returns what's written on it.
 *
 * The order of the three steps is the defense: the huge is rejected before
 * spending anything, the quota is consumed before calling the model, and the
 * quota is NOT refunded if the model fails — otherwise anyone abusing it gets
 * free attempts by making the reading fail on purpose.
 *
 * It writes no shift: saving stays on PUT /shifts, which already has the
 * review of what would be overwritten.
 */
export function readPhotoWith(
  repo: Repo,
  vision: Vision,
  today: () => IsoDate = romeToday,
  year: () => number = () => new Date().getFullYear(),
) {
  return (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    handle(async () => {
      const image = requireImage(parseJson(event.body).image);

      if (!(await repo.consumePhotoQuota(today(), MAX_READINGS_PER_DAY))) {
        return failure(
          429,
          `Hai gia' usato le ${MAX_READINGS_PER_DAY} letture di oggi. Riprova domani, oppure scrivi i codici a mano.`,
        );
      }

      let raw: unknown;
      try {
        raw = await vision(image);
      } catch (e) {
        if (e instanceof VisionFailed) {
          console.error('lettura fallita', e.message);
          return failure(502, 'Il servizio non risponde. Riprova fra un minuto.');
        }
        throw e;
      }

      try {
        return ok({ reading: validateReading(raw, year()) });
      } catch (e) {
        if (e instanceof RowNotFound) {
          return failure(
            422,
            'Non ho trovato la riga di Vanessa in questa foto. Controlla che si veda tutta la riga, dal nome fino all ultimo giorno.',
          );
        }
        if (e instanceof InvalidReading) {
          console.error('estrazione non valida', e.message);
          return failure(
            422,
            'Non sono riuscito a leggere questo foglio. Prova con piu luce, o scrivi i codici a mano.',
          );
        }
        throw e;
      }
    });
}
```

E in fondo, fra gli entry point:

```ts
export const readPhoto = (e: APIGatewayProxyEventV2) =>
  readPhotoWith(repoFromEnvironment(), createVision())(e);
```

- [ ] **Step 5: Esegui i test e verifica che passino**

Run: `cd app && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/src/handlers.ts app/api/src/http.ts app/api/test/handlers.test.ts
git commit -m "feat: l'handler che legge la foto, con la quota davanti"
```

---

### Task 5: infrastruttura

La Lambda dietro una Function URL, perché API Gateway tronca a 30 secondi e una lettura può prenderne quaranta. Più il TTL sulla tabella, che è un aggiornamento in loco e non ricrea nulla.

**Files:**
- Modify: `app/infra/lib/app-stack.ts`
- Modify: `app/infra/test/stacks.test.ts`

**Interfaces:**
- Produces: `AppStack.photoUrl: string`, output CloudFormation `PhotoUrl`.

- [ ] **Step 1: Scrivi i test che falliscono**

In `app/infra/test/stacks.test.ts`, dentro il file, aggiungi una `describe` nuova:

```ts
describe('reading photos', () => {
  it('has a Lambda with enough time for a reading', () => {
    app.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.readPhoto',
      Timeout: 120,
      ReservedConcurrentExecutions: 2,
    });
  });

  it('sits behind a Function URL, not behind API Gateway', () => {
    app.hasResourceProperties('AWS::Lambda::Url', {
      AuthType: 'NONE',
      Cors: Match.objectLike({ AllowOrigins: ['https://vanessa.matteo.cool'] }),
    });
  });

  it('can invoke the model, and nothing else of Bedrock', () => {
    app.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['bedrock:InvokeModel']),
            Effect: 'Allow',
          }),
        ]),
      }),
    });
  });

  it('the table expires the counter rows', () => {
    app.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TimeToLiveSpecification: { AttributeName: 'expires', Enabled: true },
    });
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `cd app && npx vitest run --root infra`
Expected: FAIL — non c'è nessuna `AWS::Lambda::Url`.

- [ ] **Step 3: Modifica `infra/lib/app-stack.ts`**

Aggiungi agli import:

```ts
import { FunctionUrlAuthType, HttpMethod as LambdaHttpMethod } from 'aws-cdk-lib/aws-lambda';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
```

Nel `TableV2`, aggiungi il TTL — è un aggiornamento in loco, non ricrea la tabella, e nessun item dei turni ha quell'attributo:

```ts
    const table = new TableV2(this, 'Tabella', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billing: Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      // Only the photo counter rows carry `expires`: shifts don't,
      // and they stay where they are.
      timeToLiveAttribute: 'expires',
      removalPolicy: RemovalPolicy.RETAIN,
    });
```

Dichiara il campo pubblico accanto a `apiUrl`:

```ts
  readonly apiUrl: string;
  readonly photoUrl: string;
```

Dopo `const putConfigFn = lambda('PutConfig', 'putConfig');`, aggiungi la Lambda della lettura. Non usa l'helper `lambda()` perché ha tempi, memoria e concorrenza tutti suoi:

```ts
    // A reading combines reasoning and vision: it can take more than the 30
    // seconds to which API Gateway truncates the integration. Hence the
    // Function URL, which doesn't have that limit. The other five routes are
    // untouched.
    const readPhotoFn = new NodejsFunction(this, 'ReadPhoto', {
      entry: HANDLERS,
      handler: 'readPhoto',
      projectRoot: APP_ROOT,
      depsLockFilePath: API_LOCKFILE,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(120),
      // Without API Gateway's throttling, this is the brake on parallelism.
      reservedConcurrentExecutions: 2,
      logGroup: new LogGroup(this, 'ReadPhotoLog', {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        TABLE_NAME: table.tableName,
        ALLOWED_ORIGIN: `https://${props.domain}`,
      },
      bundling: { format: undefined, minify: true, sourceMap: true },
    });

    // Writes only the quota counter, but there's only one table.
    table.grantReadWriteData(readPhotoFn);

    readPhotoFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-opus-5`],
      }),
    );

    const photoFunctionUrl = readPhotoFn.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: [`https://${props.domain}`],
        allowedMethods: [LambdaHttpMethod.POST],
        allowedHeaders: ['content-type'],
        maxAge: Duration.hours(1),
      },
    });
    this.photoUrl = photoFunctionUrl.url;
```

E fra gli output, accanto a `UrlApi`:

```ts
    new CfnOutput(this, 'PhotoUrl', { value: photoFunctionUrl.url });
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `cd app && npx vitest run --root infra && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Sintetizza per vedere che il template regga**

Run: `cd app/infra && npx cdk synth VanessaApp > /dev/null && echo ok`
Expected: `ok`, senza errori.

- [ ] **Step 6: Commit**

```bash
git add app/infra/lib/app-stack.ts app/infra/test/stacks.test.ts
git commit -m "infra: la Lambda che legge le foto, dietro una Function URL"
```

- [ ] **Step 7: Verifica il permesso Bedrock al primo deploy reale**

Il client Mantle chiama l'endpoint Messages di Bedrock, che potrebbe volere un'azione IAM diversa da `bedrock:InvokeModel`. Al primo deploy, prova una lettura vera: se torna `AccessDeniedException`, il messaggio nomina l'azione mancante — aggiungila all'elenco `actions` e ridistribuisci. Non allargare a `bedrock:*`.

---

### Task 6: il ridimensionamento e la chiamata dal browser

**Files:**
- Create: `app/web/src/image.ts`
- Create: `app/web/test/image.test.ts`
- Modify: `app/web/src/api.ts`
- Modify: `app/web/.env.production`

**Interfaces:**
- Produces:
  - `MAX_EDGE = 2576`, `scaleFor(larghezza: number, altezza: number): number`, `resize(file: File): Promise<string>` da `image.js`
  - `PHOTO_URL: string` e `Api.readPhoto(immagine: string): Promise<PhotoReading>` da `api.js`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `app/web/test/image.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { MAX_EDGE, scaleFor } from '../src/image.js';

describe('scaleFor', () => {
  it('never enlarges a photo that is already small', () => {
    expect(scaleFor(800, 600)).toBe(1);
  });

  it('brings the long edge to the max, whether horizontal or vertical', () => {
    expect(scaleFor(4032, 3024) * 4032).toBeCloseTo(MAX_EDGE);
    expect(scaleFor(3024, 4032) * 4032).toBeCloseTo(MAX_EDGE);
  });

  it('is exactly the max when the photo is already that size', () => {
    expect(scaleFor(MAX_EDGE, 1000)).toBe(1);
  });
});
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `cd app && npx vitest run --root web web/test/image.test.ts`
Expected: FAIL — `../src/image.js` non esiste.

- [ ] **Step 3: Scrivi `web/src/image.ts`**

```ts
/** Resizing the photo, before sending it.
 *
 * 2576 px on the long edge is the max the model uses anyway: sending a twelve
 * megapixel photo doesn't add a single detail read, it only adds bytes to
 * upload over the phone's network.
 *
 * The scale calculation is kept separate from the canvas drawing because it's
 * the only part that can be tested without a real browser: jsdom has neither
 * canvas nor createImageBitmap.
 */

export const MAX_EDGE = 2576;

export function scaleFor(larghezza: number, altezza: number): number {
  return Math.min(1, MAX_EDGE / Math.max(larghezza, altezza));
}

/** The photo as base64, without the data: prefix. */
export async function resize(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = scaleFor(bitmap.width, bitmap.height);
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Non riesco a preparare la foto su questo telefono.');
    ctx.drawImage(bitmap, 0, 0, w, h);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return dataUrl.slice(dataUrl.indexOf(',') + 1);
  } finally {
    bitmap.close();
  }
}
```

- [ ] **Step 4: Esegui e verifica che passi**

Run: `cd app && npx vitest run --root web web/test/image.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Aggiungi `readPhoto` a `web/src/api.ts`**

Agli import di tipo aggiungi `PhotoReading`:

```ts
import type { PhotoReading, IsoDate, PaySettings, ShiftCode } from '@vanessa/core';
```

Sotto `API_URL`:

```ts
/** Photo reading lives on its own Function URL: API Gateway truncates the
 *  integration at 30 seconds, and a reading can take longer than that. */
export const PHOTO_URL: string = import.meta.env.VITE_PHOTO_URL ?? '';
```

Aggiungi alla `interface Api`:

```ts
  readPhoto(immagine: string): Promise<PhotoReading>;
```

E all'oggetto `api`:

```ts
  async readPhoto(immagine) {
    const r = await fetch(PHOTO_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: immagine }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      let message = `lettura fallita (${r.status})`;
      try {
        const j = JSON.parse(text) as { errore?: string };
        if (j.errore) message = j.errore;
      } catch {
        /* the body wasn't JSON: the generic message stays */
      }
      throw new Error(message);
    }
    const j = (await r.json()) as { reading: PhotoReading };
    return j.reading;
  },
```

- [ ] **Step 6: Aggiungi la variabile a `web/.env.production`**

```
VITE_PHOTO_URL=https://DA-COMPILARE.lambda-url.eu-south-1.on.aws/
```

Il valore vero è l'output `PhotoUrl` dello stack: si legge dopo il primo deploy con
`aws cloudformation describe-stacks --stack-name VanessaApp --query "Stacks[0].Outputs[?OutputKey=='PhotoUrl'].OutputValue" --output text --region eu-south-1`
e si incolla qui **prima** di ricompilare il frontend.

- [ ] **Step 7: Esegui tutti i test**

Run: `cd app && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/web/src/image.ts app/web/test/image.test.ts app/web/src/api.ts app/web/.env.production
git commit -m "feat: ridimensionamento della foto e chiamata alla Function URL"
```

---

### Task 7: estrai `SavePlan` da `BulkEntry`

Rifattorizzazione pura: nessun comportamento nuovo. I test esistenti di `BulkEntry` devono passare senza essere toccati — è quello che dimostra che la rifattorizzazione è tale.

**Files:**
- Create: `app/web/src/SavePlan.tsx`
- Modify: `app/web/src/BulkEntry.tsx`

**Interfaces:**
- Consumes: `ParsedEntry`, `IsoDate`, `ShiftCode`, `MONTH_NAMES`, `planChanges` da `@vanessa/core`.
- Produces:

```ts
export interface SavePlanProps {
  entries: readonly ParsedEntry[];
  existing: ReadonlyMap<IsoDate, ShiftCode>;
  month: number;
  /** Giorni del mese senza turno: mostrati nel riepilogo, non salvati. */
  withoutShift?: number;
  /** Blocca il salvataggio quando l'input a monte non e' valido. */
  blocked?: boolean;
  onSave: (entries: readonly { date: IsoDate; code: ShiftCode }[]) => Promise<void>;
  /** Chiamato dopo un salvataggio riuscito, per ripulire la sorgente. */
  onSaved?: () => void;
}
```

- [ ] **Step 1: Verifica il punto di partenza**

Run: `cd app && npx vitest run --root web`
Expected: PASS. Prendi nota di quanti test sono: alla fine devono essere gli stessi, tutti verdi.

- [ ] **Step 2: Crea `web/src/SavePlan.tsx`**

```tsx
/** What saving would do, and the button to do it.
 *
 * It lives in its own component because two paths lead here — the hand-typed
 * sequence and the photo — and the review before overwriting is exactly the
 * part that must not depend on how you got there.
 */

import { useMemo, useState } from 'react';

import type { IsoDate, ParsedEntry, ShiftCode } from '@vanessa/core';
import { MONTH_NAMES, planChanges } from '@vanessa/core';

export interface SavePlanProps {
  entries: readonly ParsedEntry[];
  existing: ReadonlyMap<IsoDate, ShiftCode>;
  month: number;
  withoutShift?: number;
  blocked?: boolean;
  onSave: (entries: readonly { date: IsoDate; code: ShiftCode }[]) => Promise<void>;
  onSaved?: () => void;
}

export function SavePlan({
  entries,
  existing,
  month,
  withoutShift = 0,
  blocked = false,
  onSave,
  onSaved,
}: SavePlanProps) {
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  const plan = useMemo(() => planChanges(entries, existing), [entries, existing]);
  const changed = plan.filter((c) => c.kind === 'changed');
  const created = plan.filter((c) => c.kind === 'new');

  const save = async () => {
    setSaving(true);
    setDone(null);
    try {
      await onSave(entries.map(({ date, code }) => ({ date, code })));
      setDone(entries.length);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {done !== null && (
        <p className="ok" role="status">
          Salvati {done} giorni di {MONTH_NAMES[month - 1]}.
        </p>
      )}

      {plan.length > 0 && !blocked && (
        <>
          <p className="summary-line">
            <strong>{created.length}</strong> giorni nuovi ·{' '}
            <strong>{changed.length}</strong> da sovrascrivere ·{' '}
            {plan.length - created.length - changed.length} già così
            {withoutShift > 0 && <> · {withoutShift} senza turno</>}
          </p>

          {changed.length > 0 && (
            <div className="scroll-wrap">
              <table>
                <caption>Giorni che verrebbero sovrascritti</caption>
                <thead>
                  <tr>
                    <th scope="col">Giorno</th>
                    <th scope="col">Ora</th>
                    <th scope="col">Diventa</th>
                  </tr>
                </thead>
                <tbody>
                  {changed.map((c) => (
                    <tr key={c.date}>
                      <th scope="row">{c.day}</th>
                      <td>{c.previous}</td>
                      <td>{c.code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            className="primary wide"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Salvo…' : `Salva ${plan.length} giorni`}
          </button>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 3: Riscrivi `web/src/BulkEntry.tsx` per usarlo**

Sostituisci il corpo del file mantenendo `BulkEntryProps` invariato:

```tsx
/** Bulk entry: pick a month, paste a sequence of codes, review, save.
 *
 * The review step is not decoration. Pasting a sequence overwrites a whole
 * month in one action, and there is no undo — so it lives in
 * SavePlan, shared with the photo import.
 */

import { useMemo, useState } from 'react';

import type { IsoDate, ShiftCode } from '@vanessa/core';
import { MONTH_NAMES, parseSequence } from '@vanessa/core';

import { SavePlan } from './SavePlan.js';

export interface BulkEntryProps {
  year: number;
  month: number;
  onMonthChange: (m: number) => void;
  existing: ReadonlyMap<IsoDate, ShiftCode>;
  onSave: (entries: readonly { date: IsoDate; code: ShiftCode }[]) => Promise<void>;
}

export function BulkEntry({ year, month, onMonthChange, existing, onSave }: BulkEntryProps) {
  const [text, setText] = useState('');

  const parsed = useMemo(() => parseSequence(year, month, text), [year, month, text]);
  const blocked = parsed.unknown.length > 0 || parsed.tooMany;

  return (
    <section className="bulk">
      <h2>Caricamento rapido</h2>
      <p className="note">
        Scegli il mese e scrivi i codici in fila, uno per giorno a partire dal primo.
        Vanno bene virgole, spazi o a capo. Maiuscole e minuscole sono uguali.
      </p>

      <label>
        <span>Mese</span>
        <select value={month} onChange={(e) => onMonthChange(Number(e.target.value))}>
          {MONTH_NAMES.map((name, i) => (
            <option key={name} value={i + 1}>
              {name} {year}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Sequenza ({parsed.daysInMonth} giorni nel mese)</span>
        <textarea
          value={text}
          rows={5}
          placeholder="M M P1 L L M M1 P ..."
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
        />
      </label>

      {parsed.unknown.length > 0 && (
        <p className="error" role="alert">
          Non riconosco {parsed.unknown.map((u) => `"${u.token}" (posizione ${u.position})`).join(', ')}.
          I codici validi sono L, M, M1, P, P1. Correggi prima di salvare: saltarli
          sposterebbe di un giorno tutti quelli che seguono.
        </p>
      )}

      {parsed.tooMany && (
        <p className="error" role="alert">
          Hai scritto più codici dei {parsed.daysInMonth} giorni di{' '}
          {MONTH_NAMES[month - 1]}. Togline qualcuno.
        </p>
      )}

      <SavePlan
        entries={parsed.entries}
        existing={existing}
        month={month}
        blocked={blocked}
        onSave={onSave}
        onSaved={() => setText('')}
      />
    </section>
  );
}
```

- [ ] **Step 4: Esegui i test e verifica che passino, invariati**

Run: `cd app && npm test && npm run typecheck`
Expected: PASS — stesso numero di test di Step 1, nessuno modificato.

- [ ] **Step 5: Commit**

```bash
git add app/web/src/SavePlan.tsx app/web/src/BulkEntry.tsx
git commit -m "refactor: la revisione prima di salvare diventa un componente suo"
```

---

### Task 8: `PhotoImport` — la griglia

Il pezzo che Vanessa tocca. Il vincolo forte: dopo la lettura, ogni cella deve essere correggibile in un tocco, comprese quelle che il modello dà per certe.

**Files:**
- Create: `app/web/src/PhotoImport.tsx`
- Create: `app/web/test/photoImport.test.tsx`
- Modify: `app/web/src/BulkEntry.tsx`
- Modify: `app/web/src/App.tsx`
- Modify: `app/web/src/styles.css`

**Interfaces:**
- Consumes: `PhotoReading`, `ReadDay`, `entriesFromReading`, `SHIFTS`, `MONTH_NAMES`, `toIso`, `weekday` da `@vanessa/core`; `resize` da `./image.js`; `SavePlan` da `./SavePlan.js`.
- Produces:

```ts
export interface PhotoImportProps {
  year: number;
  existing: ReadonlyMap<IsoDate, ShiftCode>;
  onRead: (immagine: string) => Promise<PhotoReading>;
  onSave: (entries: readonly { date: IsoDate; code: ShiftCode }[]) => Promise<void>;
}
```

- [ ] **Step 1: Scrivi i test che falliscono**

Crea `app/web/test/photoImport.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { PhotoReading, IsoDate, ShiftCode } from '@vanessa/core';

import { PhotoImport } from '../src/PhotoImport.js';

/** July as it stands on the photo: nothing until the 16th, then fifteen shifts. */
const JULY: readonly (ShiftCode | null)[] = [
  ...Array<null>(16).fill(null),
  'M','M','P','L','P','M','M','M','L','P','M','M','M','L','P',
];

function julyReading(unsure: readonly number[] = []): PhotoReading {
  return {
    month: 7,
    year: 2026,
    found: true,
    foundName: 'Vanessa',
    foundRow: 14,
    days: JULY.map((code, i) => ({
      day: i + 1,
      code,
      confident: !unsure.includes(i + 1),
    })),
  };
}

/** jsdom has neither canvas nor createImageBitmap: the real resizing is
 *  tested on a browser. By replacing the module, the test enters through the
 *  file input the same way Vanessa does, instead of bypassing the component
 *  from the inside. */
vi.mock('../src/image.js', () => ({
  MAX_EDGE: 2576,
  scaleFor: () => 1,
  resize: () => Promise.resolve('AAAA'),
}));

async function renderWith(
  reading: PhotoReading,
  existing = new Map<IsoDate, ShiftCode>(),
) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onRead = vi.fn().mockResolvedValue(reading);
  render(<PhotoImport year={2026} existing={existing} onRead={onRead} onSave={onSave} />);

  await userEvent.upload(
    screen.getByLabelText(/Leggi da una foto/i),
    new File(['finta'], 'foglio.jpeg', { type: 'image/jpeg' }),
  );
  return { onSave, onRead };
}

describe('PhotoImport', () => {
  it('shows the month and the row it found', async () => {
    await renderWith(julyReading());
    expect(await screen.findByText(/Luglio 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/Vanessa/)).toBeInTheDocument();
  });

  it('counts the days without a shift instead of saving them', async () => {
    await renderWith(julyReading());
    expect(await screen.findByText(/16 senza turno/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salva 15 giorni/ })).toBeInTheDocument();
  });

  it('saves only the days with a shift, starting on the 17th', async () => {
    const { onSave } = await renderWith(julyReading());
    await userEvent.click(await screen.findByRole('button', { name: /Salva 15 giorni/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const sent = onSave.mock.calls[0][0];
    expect(sent).toHaveLength(15);
    expect(sent[0]).toEqual({ date: '2026-07-17', code: 'M' });
  });

  it('marks the cells the model did not read with confidence', async () => {
    await renderWith(julyReading([23]));
    const cell = await screen.findByRole('button', { name: /^23 / });
    expect(cell).toHaveClass('unsure');
  });

  it('correcting a cell changes what would be saved', async () => {
    const { onSave } = await renderWith(julyReading([23]));

    await userEvent.click(await screen.findByRole('button', { name: /^23 / }));
    await userEvent.click(screen.getByRole('button', { name: /^P1/ }));
    await userEvent.click(screen.getByRole('button', { name: /Salva 15 giorni/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const sent = onSave.mock.calls[0][0];
    expect(sent.find((s: any) => s.date === '2026-07-23')).toEqual({
      date: '2026-07-23',
      code: 'P1',
    });
  });

  it('the shift can be removed from a day, and then it is not saved', async () => {
    const { onSave } = await renderWith(julyReading());

    await userEvent.click(await screen.findByRole('button', { name: /^17 / }));
    await userEvent.click(screen.getByRole('button', { name: /Nessun turno/i }));
    await userEvent.click(screen.getByRole('button', { name: /Salva 14 giorni/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const sent = onSave.mock.calls[0][0];
    expect(sent).toHaveLength(14);
    expect(sent.find((s: any) => s.date === '2026-07-17')).toBeUndefined();
  });

  it('warns when days would be overwritten', async () => {
    const existing = new Map<IsoDate, ShiftCode>([['2026-07-17', 'L']]);
    await renderWith(julyReading(), existing);
    expect(await screen.findByText(/1 da sovrascrivere/)).toBeInTheDocument();
  });

  it('rejects a photo from another year instead of saving wrong dates', async () => {
    await renderWith({ ...julyReading(), year: 2025 });
    expect(await screen.findByRole('alert')).toHaveTextContent(/2025/);
    expect(screen.queryByRole('button', { name: /^Salva/ })).not.toBeInTheDocument();
  });

  it('the month can be corrected, and the days follow', async () => {
    const { onSave } = await renderWith(julyReading());

    // If the model had read the wrong title, taking the photo again would
    // not help: it would read the same title again. The month must be correctable.
    await userEvent.selectOptions(screen.getByLabelText(/Mese/i), '6');
    await userEvent.click(screen.getByRole('button', { name: /Salva 15 giorni/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0][0]).toEqual({ date: '2026-06-17', code: 'M' });
  });

  it('switching to a shorter month makes the extra days disappear', async () => {
    const { onSave } = await renderWith(julyReading());

    // July has 31 days, February 28: the 29th, 30th and 31st no longer exist.
    // Of July's fifteen shifts, the last three fall there.
    await userEvent.selectOptions(screen.getByLabelText(/Mese/i), '2');
    await userEvent.click(screen.getByRole('button', { name: /Salva 12 giorni/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toHaveLength(12);
  });
});
```

- [ ] **Step 2: Esegui e verifica che falliscano**

Run: `cd app && npx vitest run --root web web/test/photoImport.test.tsx`
Expected: FAIL — `../src/PhotoImport.js` non esiste.

- [ ] **Step 3: Scrivi `web/src/PhotoImport.tsx`**

```tsx
/** Import da una foto del foglio.
 *
 * The grid is editable in full, not only where the model declared itself
 * unsure: the typical mistake in a reading is a single cell, and whoever
 * spots it wrong must be able to correct it even when the model was
 * convinced of the opposite.
 */

import { useMemo, useState } from 'react';

import type { PhotoReading, IsoDate, ShiftCode } from '@vanessa/core';
import { MONTH_NAMES, SHIFTS, daysInMonth, toIso, weekday } from '@vanessa/core';

import { SavePlan } from './SavePlan.js';
import { resize } from './image.js';

export interface PhotoImportProps {
  year: number;
  existing: ReadonlyMap<IsoDate, ShiftCode>;
  onRead: (immagine: string) => Promise<PhotoReading>;
  onSave: (entries: readonly { date: IsoDate; code: ShiftCode }[]) => Promise<void>;
}

interface Reading {
  month: number;
  year: number;
  name: string;
  row: number | null;
  codes: (ShiftCode | null)[];
  unsure: Set<number>;
}

function fromReading(e: PhotoReading): Reading {
  const codes: (ShiftCode | null)[] = Array(daysInMonth(e.year, e.month)).fill(null);
  const unsure = new Set<number>();
  for (const g of e.days) {
    codes[g.day - 1] = g.code;
    if (!g.confident) unsure.add(g.day);
  }
  return { month: e.month, year: e.year, name: e.foundName ?? '', row: e.foundRow, codes, unsure };
}

export function PhotoImport({ year, existing, onRead, onSave }: PhotoImportProps) {
  const [reading, setReading] = useState<Reading | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      setReading(fromReading(await onRead(await resize(file))));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const entries = useMemo(() => {
    if (!reading) return [];
    const out: { date: IsoDate; day: number; code: ShiftCode }[] = [];
    reading.codes.forEach((code, i) => {
      if (code) out.push({ date: toIso(reading.year, reading.month, i + 1), day: i + 1, code });
    });
    return out;
  }, [reading]);

  /** The month read from the title can be wrong, and taking the photo again
   *  wouldn't help: the model would read the same title again. Changing it,
   *  the grid shrinks or grows — a shorter month loses the days that no
   *  longer exist, a longer one adds them empty. */
  const setMonth = (month: number) => {
    setReading((l) => {
      if (!l) return l;
      const howMany = daysInMonth(l.year, month);
      const codes = Array.from({ length: howMany }, (_, i) => l.codes[i] ?? null);
      const unsure = new Set([...l.unsure].filter((g) => g <= howMany));
      return { ...l, month, codes, unsure };
    });
    setOpen(null);
  };

  const setDay = (day: number, code: ShiftCode | null) => {
    setReading((l) => {
      if (!l) return l;
      const codes = [...l.codes];
      codes[day - 1] = code;
      // Corrected by hand: it's no longer unsure, regardless.
      const unsure = new Set(l.unsure);
      unsure.delete(day);
      return { ...l, codes, unsure };
    });
    setOpen(null);
  };

  // The app covers a single year: dates of a different year would find
  // nothing to compare against, and would be saved outside the visible calendar.
  const wrongYear = reading !== null && reading.year !== year;

  return (
    <div className="photo">
      {!reading && (
        <>
          <label className="photo-pick">
            <span aria-hidden="true">📷</span> Leggi da una foto
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={loading}
              onChange={(e) => void pick(e.target.files?.[0])}
            />
          </label>
          {loading && <p className="waiting">Leggo la foto… ci vuole qualche secondo.</p>}
        </>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {reading && (
        <>
          <div className="photo-head">
            <label>
              <span>Mese</span>
              <select value={reading.month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name} {reading.year}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              riga trovata: {reading.name}
              {reading.row !== null && ` (${reading.row})`}
            </p>
            <button
              type="button"
              className="toggle"
              onClick={() => {
                setReading(null);
                setError(null);
              }}
            >
              ripeti con un altra foto
            </button>
          </div>

          {wrongYear ? (
            <p className="error" role="alert">
              Questa foto è del {reading.year}, ma l&apos;app tiene i turni del {year}. Non la
              posso caricare qui.
            </p>
          ) : (
            <>
              <div className="photo-grid" role="group" aria-label="Giorni letti dalla foto">
                {reading.codes.map((code, i) => {
                  const day = i + 1;
                  const wd = weekday(toIso(reading.year, reading.month, day));
                  return (
                    <button
                      key={day}
                      type="button"
                      style={day === 1 ? { gridColumnStart: wd + 1 } : undefined}
                      className={[
                        'photo-cell',
                        code ? `t-${code}` : 'empty',
                        reading.unsure.has(day) ? 'unsure' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-label={`${day} ${code ?? 'nessun turno'}`}
                      onClick={() => setOpen(day)}
                    >
                      <span className="day-number">{day}</span>
                      <span className="code">{code ?? '–'}</span>
                    </button>
                  );
                })}
              </div>

              <SavePlan
                entries={entries}
                existing={existing}
                month={reading.month}
                withoutShift={reading.codes.filter((c) => c === null).length}
                onSave={onSave}
              />
            </>
          )}
        </>
      )}

      {open !== null && reading && (
        <div className="sheet" role="dialog" aria-label={`Giorno ${open}`}>
          <div className="sheet-head">
            <strong>
              {open} {MONTH_NAMES[reading.month - 1]}
            </strong>
            <button type="button" onClick={() => setOpen(null)}>
              Chiudi
            </button>
          </div>
          <div className="sheet-body">
            <div className="codes">
              {SHIFTS.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  className={[
                    'code-btn',
                    `t-${s.code}`,
                    reading.codes[open - 1] === s.code ? 'on' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setDay(open, s.code)}
                >
                  {s.code}
                  <span>{s.description}</span>
                </button>
              ))}
            </div>
            <button type="button" className="toggle" onClick={() => setDay(open, null)}>
              Nessun turno
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Aggiungi lo stile in `web/src/styles.css`**

In fondo al file:

```css
/* --- Import da foto --- */
.photo-pick {
  display: flex; align-items: center; justify-content: center; gap: 0.5rem;
  min-height: var(--tap); border: 1px dashed var(--navy); border-radius: 10px;
  color: var(--navy); font-weight: 700; cursor: pointer; margin: 0.6rem 0;
}
.photo-pick input { display: none; }
.photo-head { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
.photo-head h3 { margin: 0.4rem 0; }
.photo-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin: 0.5rem 0; }
.photo-cell {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: var(--tap); border: 1px solid var(--border); border-radius: 6px;
  background: #fff; padding: 0;
}
.photo-cell.empty { background: var(--bg); color: var(--muted); }
.photo-cell.t-M { background: var(--M); }
.photo-cell.t-M1 { background: var(--M1); }
.photo-cell.t-P { background: var(--P); }
.photo-cell.t-P1 { background: var(--P1); }
.photo-cell.t-L { background: var(--L); }
/* The model wasn't sure: it's shown, not blocked. */
.photo-cell.unsure .code { text-decoration: underline dashed; text-underline-offset: 2px; }
```

- [ ] **Step 5: Esegui i test e verifica che passino**

Run: `cd app && npx vitest run --root web web/test/photoImport.test.tsx`
Expected: PASS (8 test).

- [ ] **Step 6: Innesta nella vista Carica**

In `web/src/BulkEntry.tsx`, aggiungi alle props:

```ts
  onReadPhoto: (immagine: string) => Promise<import('@vanessa/core').PhotoReading>;
```

importa `PhotoImport`, e mettilo subito sotto `<h2>Caricamento rapido</h2>`, prima della nota:

```tsx
      <PhotoImport year={year} existing={existing} onRead={onReadPhoto} onSave={onSave} />

      <p className="note">oppure scrivi i codici a mano:</p>
```

In `web/src/App.tsx`, passa la funzione:

```tsx
          <BulkEntry
            year={YEAR}
            month={month}
            onMonthChange={setMonth}
            existing={codes}
            onSave={saveBulk}
            onReadPhoto={api.readPhoto}
          />
```

Nei test già esistenti che costruiscono un `Api` finto (`web/test/app.test.tsx`), aggiungi il metodo mancante:

```ts
  async readPhoto() {
    throw new Error('non usata in questo test');
  },
```

- [ ] **Step 7: Esegui tutti i test**

Run: `cd app && npm test && npm run typecheck && npm run build`
Expected: PASS, e il build passa.

- [ ] **Step 8: Commit**

```bash
git add app/web/src/PhotoImport.tsx app/web/test/photoImport.test.tsx app/web/src/BulkEntry.tsx app/web/src/App.tsx app/web/src/styles.css app/web/test/app.test.tsx
git commit -m "feat: la griglia modificabile dell'import da foto"
```

---

### Task 9: il test contro Bedrock vero, e la documentazione

Il test che dice se una modifica al prompt ha peggiorato la lettura. Fuori dalla CI, e senza le foto nel repository.

**Files:**
- Create: `app/api/test/vision.integration.test.ts`
- Modify: `app/README.md`

- [ ] **Step 1: Copia le foto fuori dal repository**

```bash
mkdir -p ~/vanessa-foto
cp ~/Downloads/"vanessa - turni luglio.jpeg" ~/vanessa-foto/luglio.jpeg
cp ~/Downloads/"vanessa - turni agosto.jpeg" ~/vanessa-foto/agosto.jpeg
```

Verifica che `~/vanessa-foto` **non** sia dentro il repository:

```bash
git -C ~/vanessa-foto rev-parse --show-toplevel 2>&1 | head -1
```
Expected: un errore «not a git repository». Se stampa un percorso, sposta la cartella altrove.

- [ ] **Step 2: Scrivi il test di integrazione**

Crea `app/api/test/vision.integration.test.ts`:

```ts
/** Le due foto vere contro Bedrock vero.
 *
 * Fuori dalla CI di proposito: costa, servono credenziali AWS, e le foto non
 * stanno nel repository — riportano nome e cognome di quattordici colleghe.
 * Serve a verificare una modifica al prompt con un comando invece che a occhio.
 *
 *   PROVA_BEDROCK=1 \
 *   FOTO_LUGLIO=~/vanessa-foto/luglio.jpeg \
 *   FOTO_AGOSTO=~/vanessa-foto/agosto.jpeg \
 *   npx vitest run --root api api/test/vision.integration.test.ts
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { validateReading, entriesFromReading } from '@vanessa/core';

import { createVision } from '../src/vision.js';

const enabled =
  process.env.PROVA_BEDROCK === '1' && !!process.env.FOTO_LUGLIO && !!process.env.FOTO_AGOSTO;

const JULY = ['M','M','P','L','P','M','M','M','L','P','M','M','M','L','P'];
const AUGUST = [
  'L','M','M','M','P','L','M','L','M','P1','L','M','P','M','P','M1',
  'L','M','P','L','M','P','M','P','L','M','P','M','P','L','M',
];

function base64(percorso: string): string {
  return readFileSync(percorso).toString('base64');
}

describe.runIf(enabled)('reading the real photos', () => {
  const vision = createVision();

  it('august: the whole month', { timeout: 180_000 }, async () => {
    const e = validateReading(await vision(base64(process.env.FOTO_AGOSTO!)), 2026);
    expect(e.month).toBe(8);
    expect(e.year).toBe(2026);
    expect(entriesFromReading(e).map((v) => v.code)).toEqual(AUGUST);
  });

  it('july: the x cells up to the 16th, then fifteen shifts', { timeout: 180_000 }, async () => {
    const e = validateReading(await vision(base64(process.env.FOTO_LUGLIO!)), 2026);
    expect(e.month).toBe(7);
    const entries = entriesFromReading(e);
    expect(entries[0].day).toBe(17);
    expect(entries.map((v) => v.code)).toEqual(JULY);
  });
});
```

- [ ] **Step 3: Esegui il test senza le variabili e verifica che si salti**

Run: `cd app && npx vitest run --root api api/test/vision.integration.test.ts`
Expected: 0 test eseguiti, nessun fallimento (la suite è saltata).

- [ ] **Step 4: Esegui il test con le foto vere**

Run:
```bash
cd app && PROVA_BEDROCK=1 \
  FOTO_LUGLIO=$HOME/vanessa-foto/luglio.jpeg \
  FOTO_AGOSTO=$HOME/vanessa-foto/agosto.jpeg \
  npx vitest run --root api api/test/vision.integration.test.ts
```
Expected: 2 test PASS.

Se un test fallisce, la differenza dice cosa il modello ha sbagliato. Prima di cambiare le attese, controlla la foto: le attese qui sono trascrizioni verificate a mano, e sono loro la verità. Se serve, lavora sul `PROMPT` in `api/src/vision.ts` — non sulle attese.

- [ ] **Step 5: Documenta in `app/README.md`**

Nella tabella delle viste, aggiorna la riga **Carica**:

```
| **Carica** | leggi il mese da una foto del foglio, oppure scrivi la sequenza dei codici. In entrambi i casi mostra quali giorni sovrascriverebbe **prima** di salvare. |
```

E aggiungi una sezione prima di *Risorse AWS*:

```markdown
## Import da foto

Vanessa fotografa il foglio affisso in reparto e l'app ne legge la sua riga.
La foto viene ridimensionata sul telefono a 2576px di lato lungo — il massimo
che il modello usa comunque — e spedita a una Lambda che chiede a Claude Opus 5
su Bedrock quali sigle ci sono nella riga intestata a Vanessa.

L'endpoint di lettura **non scrive nessun turno**: restituisce una griglia, che
si corregge a schermo e si salva con la stessa rotta della sequenza scritta a
mano, revisione compresa. I giorni senza codice — le `x` di un mese iniziato a
metà — non si salvano e non cancellano niente.

Sta dietro una **Lambda Function URL** e non dietro API Gateway, che tronca
l'integrazione a 30 secondi: una lettura ne può prendere di più. L'indirizzo è
l'output `PhotoUrl` dello stack e va in `web/.env.production` come
`VITE_PHOTO_URL` prima di ricompilare il frontend.

Ogni lettura costa circa 0,09 €, su un'API che resta aperta. Le difese sono un
**tetto di 10 letture al giorno** (contatore su DynamoDB, condizione e
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
```

- [ ] **Step 6: Esegui tutto**

Run: `cd app && npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/test/vision.integration.test.ts app/README.md
git commit -m "test: le due foto vere contro Bedrock, e la documentazione"
```

---

## Dopo il merge: il primo deploy

1. `git push` su `main` lancia la pipeline, che distribuisce lo stack.
2. Leggi l'indirizzo della Function URL:
   ```bash
   aws cloudformation describe-stacks --stack-name VanessaApp --region eu-south-1 \
     --query "Stacks[0].Outputs[?OutputKey=='PhotoUrl'].OutputValue" --output text
   ```
3. Incollalo in `app/web/.env.production` come `VITE_PHOTO_URL`, committa, e lascia che la pipeline ricompili il frontend. **Finché questo passo manca, il pulsante della foto chiama una stringa vuota e fallisce.**
4. Prova una lettura vera dal telefono. Se torna `AccessDeniedException`, il messaggio nomina l'azione IAM che manca: aggiungila al `PolicyStatement` di `ReadPhoto` (Task 5, Step 7) e ridistribuisci.
5. Metti un allarme di budget sull'account, se non c'è già.
