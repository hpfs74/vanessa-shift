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
| `app/core/src/foto.ts` (nuovo) | Tipi dell'estrazione, schema JSON per il modello, validazione, conversione in `ParsedEntry[]`. Puro. |
| `app/core/src/dates.ts` (modificato) | `giornoRoma()`: la data civile italiana, per la chiave della quota. |
| `app/core/src/index.ts` (modificato) | Riesporta `foto.js`. |
| `app/api/src/repo.ts` (modificato) | `consumaQuotaFoto()`: contatore atomico giornaliero. |
| `app/api/src/visione.ts` (nuovo) | La chiamata a Bedrock: prompt, immagine, schema, lettura della risposta. |
| `app/api/src/http.ts` (modificato) | `requireImmagine()` e la costante del corpo massimo. |
| `app/api/src/handlers.ts` (modificato) | `leggiFoto`: dimensione → quota → visione → validazione. |
| `app/infra/lib/app-stack.ts` (modificato) | Lambda `LeggiFoto`, Function URL, permesso Bedrock, TTL sulla tabella. |
| `app/web/src/immagine.ts` (nuovo) | Ridimensionamento su canvas. |
| `app/web/src/api.ts` (modificato) | `leggiFoto()` verso la Function URL. |
| `app/web/src/PianoSalvataggio.tsx` (nuovo) | Estratto da `BulkEntry`: riepilogo, tabella delle sovrascritture, pulsante. Condiviso fra testo e foto. |
| `app/web/src/BulkEntry.tsx` (modificato) | Tiene la textarea, delega il resto, ospita il percorso foto. |
| `app/web/src/PhotoImport.tsx` (nuovo) | Scelta della foto, stato della lettura, griglia modificabile. |
| `app/web/src/App.tsx` (modificato) | Passa `api.leggiFoto` a `BulkEntry`. |

---

### Task 1: `core/src/foto.ts` — il contratto e il suo giudice

Il pezzo che decide se quello che il modello ha detto è utilizzabile. Puro, senza rete: è il posto dove si testano tutti i modi in cui un'estrazione può essere sbagliata.

**Files:**
- Create: `app/core/src/foto.ts`
- Create: `app/core/test/foto.test.ts`
- Modify: `app/core/src/index.ts`
- Modify: `app/core/src/dates.ts` (aggiunta di `giornoRoma`)

**Interfaces:**
- Consumes: `ShiftCode`, `isShiftCode` da `./shifts.js`; `IsoDate`, `daysInMonth`, `toIso` da `./dates.js`; `ParsedEntry` da `./bulk.js`.
- Produces:
  - `NOME_RIGA: string` (`'Vanessa'`), `MAX_LETTURE_AL_GIORNO: number` (`10`)
  - `interface GiornoLetto { giorno: number; codice: ShiftCode | null; sicuro: boolean }`
  - `interface EstrazioneFoto { mese: number; anno: number; trovata: boolean; nomeTrovato: string | null; rigaTrovata: number | null; giorni: GiornoLetto[] }`
  - `SCHEMA_ESTRAZIONE: Record<string, unknown>`
  - `class FotoNonValida extends Error`, `class RigaNonTrovata extends Error`
  - `validaEstrazione(v: unknown, annoAtteso: number): EstrazioneFoto`
  - `vociDaEstrazione(e: EstrazioneFoto): ParsedEntry[]`
  - `giornoRoma(now?: Date): IsoDate` (da `dates.js`)

- [ ] **Step 1: Scrivi i test che falliscono**

Crea `app/core/test/foto.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  FotoNonValida,
  RigaNonTrovata,
  giornoRoma,
  validaEstrazione,
  vociDaEstrazione,
} from '../src/index.js';

/** Un'estrazione ben formata di `giorni` giorni, tutti senza turno. */
function vuota(mese: number, anno: number, giorni: number) {
  return {
    mese,
    anno,
    trovata: true,
    nomeTrovato: 'Vanessa',
    rigaTrovata: 14,
    giorni: Array.from({ length: giorni }, (_, i) => ({
      giorno: i + 1,
      codice: null,
      sicuro: true,
    })),
  };
}

/** Luglio come sta sulla foto: x fino al 16, poi quindici turni. */
const LUGLIO_CODICI = ['M','M','P','L','P','M','M','M','L','P','M','M','M','L','P'] as const;

function luglio() {
  const e = vuota(7, 2026, 31);
  LUGLIO_CODICI.forEach((codice, i) => {
    e.giorni[16 + i] = { giorno: 17 + i, codice, sicuro: true } as never;
  });
  return e;
}

describe('validaEstrazione', () => {
  it('accetta un mese intero ben formato', () => {
    const e = validaEstrazione(vuota(8, 2026, 31), 2026);
    expect(e.mese).toBe(8);
    expect(e.giorni).toHaveLength(31);
  });

  it('accetta l anno prima e quello dopo, non uno lontano', () => {
    expect(() => validaEstrazione(vuota(8, 2025, 31), 2026)).not.toThrow();
    expect(() => validaEstrazione(vuota(8, 2027, 31), 2026)).not.toThrow();
    expect(() => validaEstrazione(vuota(8, 2019, 31), 2026)).toThrow(FotoNonValida);
  });

  it('rifiuta un mese fuori scala', () => {
    expect(() => validaEstrazione({ ...vuota(1, 2026, 31), mese: 13 }, 2026)).toThrow(
      FotoNonValida,
    );
  });

  it('vuole esattamente i giorni del mese: febbraio 2026 ne ha 28', () => {
    expect(() => validaEstrazione(vuota(2, 2026, 28), 2026)).not.toThrow();
    expect(() => validaEstrazione(vuota(2, 2026, 29), 2026)).toThrow(FotoNonValida);
  });

  it('rifiuta un giorno mancante', () => {
    const e = vuota(8, 2026, 31);
    e.giorni.splice(10, 1);
    expect(() => validaEstrazione(e, 2026)).toThrow(FotoNonValida);
  });

  it('rifiuta un giorno duplicato', () => {
    const e = vuota(8, 2026, 31);
    e.giorni[11] = { giorno: 11, codice: null, sicuro: true };
    expect(() => validaEstrazione(e, 2026)).toThrow(FotoNonValida);
  });

  it('rifiuta un giorno fuori dal mese', () => {
    const e = vuota(8, 2026, 31);
    e.giorni[30] = { giorno: 32, codice: null, sicuro: true };
    expect(() => validaEstrazione(e, 2026)).toThrow(FotoNonValida);
  });

  it('rifiuta un codice che non esiste', () => {
    const e = vuota(8, 2026, 31);
    e.giorni[0] = { giorno: 1, codice: 'P2' as never, sicuro: true };
    expect(() => validaEstrazione(e, 2026)).toThrow(FotoNonValida);
  });

  it('rifiuta qualcosa che non e nemmeno un oggetto', () => {
    expect(() => validaEstrazione('ciao', 2026)).toThrow(FotoNonValida);
    expect(() => validaEstrazione(null, 2026)).toThrow(FotoNonValida);
    expect(() => validaEstrazione([], 2026)).toThrow(FotoNonValida);
  });

  it('quando la riga non c e lo dice con un errore suo', () => {
    const e = { ...vuota(8, 2026, 31), trovata: false, nomeTrovato: null, rigaTrovata: null };
    expect(() => validaEstrazione(e, 2026)).toThrow(RigaNonTrovata);
  });
});

describe('vociDaEstrazione', () => {
  it('salta i giorni senza codice: luglio comincia il 17', () => {
    const voci = vociDaEstrazione(validaEstrazione(luglio(), 2026));
    expect(voci).toHaveLength(15);
    expect(voci[0]).toEqual({ date: '2026-07-17', day: 17, code: 'M' });
    expect(voci[14]).toEqual({ date: '2026-07-31', day: 31, code: 'P' });
  });

  it('un mese senza nulla non produce voci', () => {
    expect(vociDaEstrazione(validaEstrazione(vuota(8, 2026, 31), 2026))).toEqual([]);
  });
});

describe('giornoRoma', () => {
  it('e la data italiana, non quella UTC', () => {
    // Mezzanotte e mezza a Roma d'estate: a Greenwich e ancora il giorno prima.
    expect(giornoRoma(new Date('2026-08-02T22:30:00Z'))).toBe('2026-08-03');
    expect(giornoRoma(new Date('2026-08-02T12:00:00Z'))).toBe('2026-08-02');
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `cd app && npx vitest run --root core core/test/foto.test.ts`
Expected: FAIL — `validaEstrazione` non è esportata da `../src/index.js`.

- [ ] **Step 3: Aggiungi `giornoRoma` a `core/src/dates.ts`**

In fondo a `app/core/src/dates.ts`, subito dopo `today()`:

```ts
/** La data civile italiana.
 *
 * La Lambda gira in UTC, dove il giorno cambia all'una o alle due di notte
 * ora italiana: un contatore giornaliero appeso a UTC si azzererebbe mentre
 * qui e ancora ieri. 'sv-SE' e la scorciatoia per avere YYYY-MM-DD. */
export function giornoRoma(now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(now);
}
```

- [ ] **Step 4: Scrivi `core/src/foto.ts`**

```ts
/** Import da una foto del foglio dei turni.
 *
 * Qui non si legge nessuna immagine: qui si decide se quello che il modello
 * ha detto di aver letto e utilizzabile. Mezza griglia plausibile e peggio di
 * un errore, perche si salva senza accorgersene: la validazione e quindi tutto
 * o niente.
 */

import { type IsoDate, daysInMonth, toIso } from './dates.js';
import type { ParsedEntry } from './bulk.js';
import { type ShiftCode, SHIFTS, isShiftCode } from './shifts.js';

/** La riga da cercare sul foglio. */
export const NOME_RIGA = 'Vanessa';

/** L'API e aperta e ogni lettura costa: il tetto e la difesa principale. */
export const MAX_LETTURE_AL_GIORNO = 10;

export interface GiornoLetto {
  readonly giorno: number;
  /** null vuol dire "sul foglio non c'e un turno": una x, una cella vuota,
   *  o una cella illeggibile. Ai fini del salvataggio sono la stessa cosa. */
  readonly codice: ShiftCode | null;
  /** Suggerimento del modello, non verdetto: serve a sottolineare la cella.
   *  Tutte le celle restano modificabili. */
  readonly sicuro: boolean;
}

export interface EstrazioneFoto {
  readonly mese: number;
  readonly anno: number;
  readonly trovata: boolean;
  readonly nomeTrovato: string | null;
  readonly rigaTrovata: number | null;
  readonly giorni: readonly GiornoLetto[];
}

/** La forma che il modello e obbligato a restituire.
 *
 * Niente minimi e massimi numerici: gli output strutturati non li applicano,
 * e comunque il giudice e validaEstrazione, non lo schema. */
export const SCHEMA_ESTRAZIONE: Record<string, unknown> = {
  type: 'object',
  properties: {
    mese: { type: 'integer' },
    anno: { type: 'integer' },
    trovata: { type: 'boolean' },
    nomeTrovato: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    rigaTrovata: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    giorni: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          giorno: { type: 'integer' },
          codice: {
            anyOf: [{ type: 'string', enum: SHIFTS.map((s) => s.code) }, { type: 'null' }],
          },
          sicuro: { type: 'boolean' },
        },
        required: ['giorno', 'codice', 'sicuro'],
        additionalProperties: false,
      },
    },
  },
  required: ['mese', 'anno', 'trovata', 'nomeTrovato', 'rigaTrovata', 'giorni'],
  additionalProperties: false,
};

/** L'estrazione non si puo usare. */
export class FotoNonValida extends Error {}

/** La riga cercata non c'e nella foto: e un caso a parte, perche il rimedio
 *  che si suggerisce e diverso (rifotografare, non riscrivere). */
export class RigaNonTrovata extends Error {}

function intero(v: unknown, campo: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new FotoNonValida(`${campo}: atteso un intero`);
  }
  return v;
}

export function validaEstrazione(v: unknown, annoAtteso: number): EstrazioneFoto {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new FotoNonValida('estrazione: atteso un oggetto');
  }
  const e = v as Record<string, unknown>;

  if (e.trovata !== true) throw new RigaNonTrovata(`riga di ${NOME_RIGA} non trovata`);

  const mese = intero(e.mese, 'mese');
  if (mese < 1 || mese > 12) throw new FotoNonValida('mese: fuori da 1-12');

  const anno = intero(e.anno, 'anno');
  if (Math.abs(anno - annoAtteso) > 1) throw new FotoNonValida('anno: troppo lontano');

  if (typeof e.nomeTrovato !== 'string' || e.nomeTrovato.length === 0) {
    throw new FotoNonValida('nomeTrovato: atteso un nome');
  }
  const rigaTrovata = intero(e.rigaTrovata, 'rigaTrovata');

  if (!Array.isArray(e.giorni)) throw new FotoNonValida('giorni: atteso un elenco');
  const attesi = daysInMonth(anno, mese);
  if (e.giorni.length !== attesi) {
    throw new FotoNonValida(`giorni: attesi ${attesi}, ricevuti ${e.giorni.length}`);
  }

  const visti = new Set<number>();
  const giorni: GiornoLetto[] = e.giorni.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new FotoNonValida(`giorni[${i}]: atteso un oggetto`);
    }
    const g = raw as Record<string, unknown>;
    const giorno = intero(g.giorno, `giorni[${i}].giorno`);
    if (giorno < 1 || giorno > attesi) {
      throw new FotoNonValida(`giorni[${i}].giorno: ${giorno} non e nel mese`);
    }
    // Lo stesso giorno due volte vorrebbe dire che una colonna e stata letta
    // due volte e un'altra mai: la griglia non e allineata.
    if (visti.has(giorno)) throw new FotoNonValida(`giorno ${giorno} compare due volte`);
    visti.add(giorno);

    const codice = g.codice;
    if (codice !== null && !isShiftCode(codice)) {
      throw new FotoNonValida(`giorni[${i}].codice: codice turno sconosciuto`);
    }
    if (typeof g.sicuro !== 'boolean') {
      throw new FotoNonValida(`giorni[${i}].sicuro: atteso un booleano`);
    }
    return { giorno, codice: codice as ShiftCode | null, sicuro: g.sicuro };
  });

  return { mese, anno, trovata: true, nomeTrovato: e.nomeTrovato, rigaTrovata, giorni };
}

/** Solo i giorni con un turno. Gli altri non si salvano e non cancellano
 *  nulla: una foto puo essere tagliata, e cancellare non ha ritorno. */
export function vociDaEstrazione(e: EstrazioneFoto): ParsedEntry[] {
  const out: ParsedEntry[] = [];
  for (const g of e.giorni) {
    if (g.codice === null) continue;
    out.push({ date: toIso(e.anno, e.mese, g.giorno), day: g.giorno, code: g.codice });
  }
  return out;
}

export type { IsoDate };
```

- [ ] **Step 5: Riesporta da `core/src/index.ts`**

Aggiungi in fondo:

```ts
export * from './foto.js';
```

- [ ] **Step 6: Esegui i test e verifica che passino**

Run: `cd app && npm test && npm run typecheck`
Expected: PASS, compresi i test già esistenti di `core`.

- [ ] **Step 7: Commit**

```bash
git add app/core/src/foto.ts app/core/src/dates.ts app/core/src/index.ts app/core/test/foto.test.ts
git commit -m "feat: il contratto dell'estrazione da foto, e il suo giudice"
```

---

### Task 2: la quota giornaliera

Un contatore atomico. Il punto delicato è che due richieste simultanee al confine non devono passare entrambe, quindi la condizione e l'incremento sono la stessa operazione.

**Files:**
- Modify: `app/api/src/repo.ts`
- Create: `app/api/test/repo.test.ts`

**Interfaces:**
- Consumes: `MAX_LETTURE_AL_GIORNO` da `@vanessa/core`.
- Produces: sull'interfaccia `Repo`, `consumaQuotaFoto(giorno: IsoDate, max: number): Promise<boolean>` — `true` se la lettura è concessa, `false` se il tetto è già stato raggiunto. Costante esportata `QUOTA_PK = 'QUOTA#FOTO'`.

- [ ] **Step 1: Scrivi i test che falliscono**

Crea `app/api/test/repo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { QUOTA_PK, createRepo } from '../src/repo.js';

/** DynamoDB finto, con la sola semantica che ci interessa: ADD su un numero,
 *  e una condizione valutata sull'item com'era prima dell'aggiornamento. */
function fakeDoc(max: number) {
  const conteggi = new Map<string, number>();
  const doc = {
    async send(cmd: { input: Record<string, any> }) {
      const key = String(cmd.input.Key.sk);
      const attuale = conteggi.get(key) ?? 0;
      const limite = Number(cmd.input.ExpressionAttributeValues[':max']);
      if (conteggi.has(key) && attuale >= limite) {
        const e = new Error('condizione fallita');
        e.name = 'ConditionalCheckFailedException';
        throw e;
      }
      conteggi.set(key, attuale + 1);
      return {};
    },
  };
  return { doc: doc as unknown as DynamoDBDocumentClient, conteggi, max };
}

describe('consumaQuotaFoto', () => {
  it('concede le letture fino al tetto e non oltre', async () => {
    const { doc, conteggi } = fakeDoc(3);
    const repo = createRepo('tabella', doc);

    expect(await repo.consumaQuotaFoto('2026-08-02', 3)).toBe(true);
    expect(await repo.consumaQuotaFoto('2026-08-02', 3)).toBe(true);
    expect(await repo.consumaQuotaFoto('2026-08-02', 3)).toBe(true);
    expect(await repo.consumaQuotaFoto('2026-08-02', 3)).toBe(false);
    expect(conteggi.get('2026-08-02')).toBe(3);
  });

  it('il giorno dopo riparte da zero', async () => {
    const { doc } = fakeDoc(1);
    const repo = createRepo('tabella', doc);

    expect(await repo.consumaQuotaFoto('2026-08-02', 1)).toBe(true);
    expect(await repo.consumaQuotaFoto('2026-08-02', 1)).toBe(false);
    expect(await repo.consumaQuotaFoto('2026-08-03', 1)).toBe(true);
  });

  it('scrive sotto la chiave della quota, non fra i turni', async () => {
    const chiavi: Record<string, unknown>[] = [];
    const doc = {
      async send(cmd: { input: Record<string, any> }) {
        chiavi.push(cmd.input.Key);
        return {};
      },
    } as unknown as DynamoDBDocumentClient;

    await createRepo('tabella', doc).consumaQuotaFoto('2026-08-02', 10);
    expect(chiavi[0]).toEqual({ pk: QUOTA_PK, sk: '2026-08-02' });
  });

  it('un errore che non sia la condizione risale, non diventa un no silenzioso', async () => {
    const doc = {
      async send() {
        throw new Error('rete');
      },
    } as unknown as DynamoDBDocumentClient;

    await expect(createRepo('tabella', doc).consumaQuotaFoto('2026-08-02', 10)).rejects.toThrow(
      'rete',
    );
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `cd app && npx vitest run --root api api/test/repo.test.ts`
Expected: FAIL — `QUOTA_PK` non esiste e `consumaQuotaFoto` non è sul `Repo`.

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
/** Il contatore delle letture da foto, una riga per giorno. */
export const QUOTA_PK = 'QUOTA#FOTO';

/** Quanto sopravvive una riga di conteggio dopo il suo giorno. Due giorni
 *  bastano a coprire qualsiasi fuso e lasciano la tabella pulita. */
const QUOTA_TTL_GIORNI = 2;
```

Nell'interfaccia `Repo`, dopo `savePaySettings`:

```ts
  /** Consuma una lettura da foto per quel giorno. `false` se il tetto e gia
   *  stato raggiunto. Condizione e incremento sono la stessa operazione:
   *  due richieste simultanee al confine non devono passare entrambe. */
  consumaQuotaFoto(giorno: IsoDate, max: number): Promise<boolean>;
```

E nell'oggetto restituito da `createRepo`, dopo `savePaySettings`:

```ts
    async consumaQuotaFoto(giorno, max) {
      const { year, month, day } = parseIso(giorno);
      const scade = Math.floor(Date.UTC(year, month - 1, day + QUOTA_TTL_GIORNI) / 1000);
      try {
        await doc.send(
          new UpdateCommand({
            TableName: table,
            Key: { pk: QUOTA_PK, sk: giorno },
            UpdateExpression: 'SET scade = :scade ADD conteggio :uno',
            ConditionExpression: 'attribute_not_exists(conteggio) OR conteggio < :max',
            ExpressionAttributeValues: { ':uno': 1, ':max': max, ':scade': scade },
          }),
        );
        return true;
      } catch (e) {
        // La condizione fallita e una risposta, non un guasto: il tetto e
        // stato raggiunto. Qualsiasi altro errore deve risalire.
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
    async consumaQuotaFoto(giorno, max) {
      calls.push(`consumaQuotaFoto(${giorno},${max})`);
      const usate = (quota.get(giorno) ?? 0) + 1;
      if (usate > max) return false;
      quota.set(giorno, usate);
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

### Task 3: `api/src/visione.ts` — la chiamata a Bedrock

L'unico pezzo che parla col modello. Non giudica niente: restituisce quello che ha ricevuto, e lascia giudicare a `core`.

**Files:**
- Create: `app/api/src/visione.ts`
- Create: `app/api/test/visione.test.ts`
- Modify: `app/api/package.json`

**Interfaces:**
- Consumes: `NOME_RIGA`, `SCHEMA_ESTRAZIONE` da `@vanessa/core`.
- Produces:
  - `type Visione = (immagineBase64: string) => Promise<unknown>`
  - `MODELLO = 'anthropic.claude-opus-5'`
  - `class VisioneFallita extends Error`
  - `creaVisione(client?: ClienteMessaggi): Visione`
  - `interface ClienteMessaggi { messages: { create(body: unknown): Promise<RispostaMessaggi> } }` — il minimo che serve, così i test non montano l'SDK
  - `interface RispostaMessaggi { stop_reason?: string | null; content: { type: string; text?: string }[] }`

- [ ] **Step 1: Aggiungi la dipendenza**

```bash
cd app && npm install --workspace @vanessa/api @anthropic-ai/bedrock-sdk
```

- [ ] **Step 2: Scrivi i test che falliscono**

Crea `app/api/test/visione.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { NOME_RIGA } from '@vanessa/core';

import { MODELLO, VisioneFallita, creaVisione } from '../src/visione.js';

function clienteChe(risposta: unknown) {
  const inviati: any[] = [];
  const client = {
    messages: {
      async create(body: unknown) {
        inviati.push(body);
        return risposta as never;
      },
    },
  };
  return { client, inviati };
}

const RISPOSTA_BUONA = {
  stop_reason: 'end_turn',
  content: [
    { type: 'thinking', thinking: '' },
    { type: 'text', text: '{"mese":8,"anno":2026,"trovata":true}' },
  ],
};

describe('creaVisione', () => {
  it('restituisce il JSON del blocco di testo, gia deserializzato', async () => {
    const { client } = clienteChe(RISPOSTA_BUONA);
    const out = await creaVisione(client)('AAAA');
    expect(out).toEqual({ mese: 8, anno: 2026, trovata: true });
  });

  it('manda immagine, modello, schema e il nome della riga', async () => {
    const { client, inviati } = clienteChe(RISPOSTA_BUONA);
    await creaVisione(client)('AAAA');

    const b = inviati[0];
    expect(b.model).toBe(MODELLO);
    expect(b.output_config.format.type).toBe('json_schema');

    const blocchi = b.messages[0].content;
    const immagine = blocchi.find((c: any) => c.type === 'image');
    expect(immagine.source).toEqual({
      type: 'base64',
      media_type: 'image/jpeg',
      data: 'AAAA',
    });
    const testo = blocchi.find((c: any) => c.type === 'text').text;
    expect(testo).toContain(NOME_RIGA);
  });

  it('salta i blocchi di ragionamento e prende il testo', async () => {
    const { client } = clienteChe({
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":1}' }],
    });
    expect(await creaVisione(client)('AAAA')).toEqual({ a: 1 });
  });

  it('un rifiuto del modello non e un JSON da leggere', async () => {
    const { client } = clienteChe({ stop_reason: 'refusal', content: [] });
    await expect(creaVisione(client)('AAAA')).rejects.toThrow(VisioneFallita);
  });

  it('una risposta troncata non e un JSON da leggere', async () => {
    const { client } = clienteChe({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"mese":8' }],
    });
    await expect(creaVisione(client)('AAAA')).rejects.toThrow(VisioneFallita);
  });

  it('nessun blocco di testo e un errore, non un undefined che viaggia', async () => {
    const { client } = clienteChe({ stop_reason: 'end_turn', content: [] });
    await expect(creaVisione(client)('AAAA')).rejects.toThrow(VisioneFallita);
  });

  it('testo che non e JSON e un errore', async () => {
    const { client } = clienteChe({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'mi dispiace' }],
    });
    await expect(creaVisione(client)('AAAA')).rejects.toThrow(VisioneFallita);
  });
});
```

- [ ] **Step 3: Esegui i test e verifica che falliscano**

Run: `cd app && npx vitest run --root api api/test/visione.test.ts`
Expected: FAIL — `../src/visione.js` non esiste.

- [ ] **Step 4: Scrivi `api/src/visione.ts`**

```ts
/** La lettura della foto: l'unico punto che parla con il modello.
 *
 * Non giudica niente. Restituisce quello che ha ricevuto, gia deserializzato,
 * e lascia a `core` il compito di dire se e utilizzabile: il giudizio e logica
 * di dominio, e deve poter essere testato senza rete.
 *
 * Il prompt e in italiano come il foglio che descrive: le sigle, i nomi dei
 * mesi e la parola "turno" sono il vocabolario del documento.
 */

import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';

import { NOME_RIGA, SCHEMA_ESTRAZIONE, SHIFTS } from '@vanessa/core';

export const MODELLO = 'anthropic.claude-opus-5';
export const REGIONE = process.env.AWS_REGION ?? 'eu-south-1';

/** Il minimo che serve del client, cosi i test non montano l'SDK. */
export interface RispostaMessaggi {
  stop_reason?: string | null;
  content: { type: string; text?: string }[];
}
export interface ClienteMessaggi {
  messages: { create(body: unknown): Promise<RispostaMessaggi> };
}

export type Visione = (immagineBase64: string) => Promise<unknown>;

/** La lettura non e riuscita. Il chiamante la traduce in un messaggio. */
export class VisioneFallita extends Error {}

const CODICI = SHIFTS.map((s) => s.code).join(', ');

const PROMPT = `Questa foto e' il foglio dei turni mensile di una struttura sanitaria.

E' una griglia: ogni riga e' una persona, ogni colonna e' un giorno del mese.
Sopra le colonne c'e' una riga con i numeri dei giorni, da 1 fino alla fine del
mese: usala per allineare le colonne, non contarle a occhio. In alto c'e' il
titolo con il mese e l'anno.

Devi leggere UNA SOLA riga: quella della persona di nome ${NOME_RIGA}.
I nomi stanno a sinistra, su due righe (cognome sopra, nome sotto): la riga dei
turni e' quella del nome.

Per ogni giorno del mese riporta la sigla che sta nella cella di quella riga.
Le sigle valide sono soltanto: ${CODICI}.
Se la cella contiene una x, e' vuota, oppure non riesci a leggerla con
ragionevole certezza, metti codice null.

Attenzione: le altre righe contengono anche sigle diverse (F, R, C, N1 e altre).
Non riguardano questa persona. Non riportare mai la cella di un'altra riga.

Riporta un elemento per OGNI giorno del mese, dal primo all'ultimo, anche per i
giorni con codice null. Metti sicuro a false quando la cella e' sbiadita,
corretta a mano, ambigua o coperta.

Se nella foto non c'e' nessuna riga intestata a ${NOME_RIGA}, metti trovata a
false e giorni a un elenco vuoto.`;

/** Il ragionamento su Claude Opus 5 e attivo per impostazione predefinita, ed
 *  e' quello che serve: contare trentuno colonne storte e scritte a mano non e'
 *  un colpo d'occhio. Il tetto dei token vale per ragionamento piu' risposta
 *  insieme, quindi sta largo: stretto, tronca a meta'. */
const MAX_TOKENS = 8000;

export function creaVisione(client?: ClienteMessaggi): Visione {
  const c: ClienteMessaggi =
    client ?? (new AnthropicBedrockMantle({ awsRegion: REGIONE }) as unknown as ClienteMessaggi);

  return async (immagineBase64: string) => {
    const risposta = await c.messages.create({
      model: MODELLO,
      max_tokens: MAX_TOKENS,
      output_config: { format: { type: 'json_schema', schema: SCHEMA_ESTRAZIONE } },
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

    // I classificatori possono rifiutare: e un 200 con content vuoto, non un
    // errore HTTP. Leggere content[0] qui darebbe un undefined che viaggia.
    if (risposta.stop_reason === 'refusal') {
      throw new VisioneFallita('il modello ha rifiutato la richiesta');
    }
    if (risposta.stop_reason === 'max_tokens') {
      throw new VisioneFallita('risposta troncata');
    }

    const testo = risposta.content.find((b) => b.type === 'text')?.text;
    if (!testo) throw new VisioneFallita('nessun blocco di testo nella risposta');

    try {
      return JSON.parse(testo);
    } catch {
      throw new VisioneFallita('la risposta non e JSON');
    }
  };
}
```

- [ ] **Step 5: Esegui i test e verifica che passino**

Run: `cd app && npx vitest run --root api api/test/visione.test.ts`
Expected: PASS (7 test).

- [ ] **Step 6: Commit**

```bash
git add app/api/src/visione.ts app/api/test/visione.test.ts app/api/package.json app/package-lock.json
git commit -m "feat: la lettura della foto con Claude Opus 5 su Bedrock"
```

---

### Task 4: l'handler `leggiFoto`

Cuce insieme i tre pezzi nell'ordine che conta: prima si rifiuta quello che è troppo grande (senza spendere), poi si consuma la quota, poi si spende.

**Files:**
- Modify: `app/api/src/http.ts`
- Modify: `app/api/src/handlers.ts`
- Modify: `app/api/test/handlers.test.ts`

**Interfaces:**
- Consumes: `Repo.consumaQuotaFoto` (Task 2), `Visione` e `VisioneFallita` (Task 3), `validaEstrazione`, `FotoNonValida`, `RigaNonTrovata`, `MAX_LETTURE_AL_GIORNO`, `giornoRoma` (Task 1).
- Produces: `MAX_CORPO_BYTE` e `requireImmagine(v: unknown): string` da `http.js`; `leggiFotoWith(repo: Repo, visione: Visione, oggi?: () => IsoDate, anno?: () => number)` e l'entry point `leggiFoto` da `handlers.js`.

- [ ] **Step 1: Scrivi i test che falliscono**

In fondo a `app/api/test/handlers.test.ts` aggiungi:

```ts
import { leggiFotoWith } from '../src/handlers.js';
import { VisioneFallita } from '../src/visione.js';

/** Un'estrazione valida di agosto, con un solo turno il primo del mese. */
function estrazioneAgosto() {
  return {
    mese: 8,
    anno: 2026,
    trovata: true,
    nomeTrovato: 'Vanessa',
    rigaTrovata: 12,
    giorni: Array.from({ length: 31 }, (_, i) => ({
      giorno: i + 1,
      codice: i === 0 ? 'L' : null,
      sicuro: true,
    })),
  };
}

function eventoFoto(immagine: string) {
  return event({ body: JSON.stringify({ immagine }) });
}

describe('leggiFoto', () => {
  const oggi = () => '2026-08-02';
  const anno = () => 2026;

  it('legge la foto e restituisce l estrazione', async () => {
    const { repo } = fakeRepo();
    const h = leggiFotoWith(repo, async () => estrazioneAgosto(), oggi, anno);

    const r: any = await h(eventoFoto('AAAA'));
    expect(r.statusCode).toBe(200);
    expect(body(r).estrazione.giorni).toHaveLength(31);
    expect(body(r).estrazione.mese).toBe(8);
  });

  it('non scrive nessun turno', async () => {
    const { repo, shifts } = fakeRepo();
    const h = leggiFotoWith(repo, async () => estrazioneAgosto(), oggi, anno);

    await h(eventoFoto('AAAA'));
    expect(shifts.size).toBe(0);
  });

  it('oltre il tetto risponde 429 senza chiamare il modello', async () => {
    const { repo } = fakeRepo();
    let chiamate = 0;
    const h = leggiFotoWith(
      repo,
      async () => {
        chiamate += 1;
        return estrazioneAgosto();
      },
      oggi,
      anno,
    );

    for (let i = 0; i < 10; i++) {
      const consentita: any = await h(eventoFoto('AAAA'));
      expect(consentita.statusCode).toBe(200);
    }
    const r: any = await h(eventoFoto('AAAA'));
    expect(r.statusCode).toBe(429);
    expect(chiamate).toBe(10);
  });

  it('un corpo troppo grande e 413, senza toccare quota ne modello', async () => {
    const { repo, calls } = fakeRepo();
    let chiamate = 0;
    const h = leggiFotoWith(
      repo,
      async () => {
        chiamate += 1;
        return estrazioneAgosto();
      },
      oggi,
      anno,
    );

    const r: any = await h(eventoFoto('A'.repeat(2 * 1024 * 1024 + 1)));
    expect(r.statusCode).toBe(413);
    expect(chiamate).toBe(0);
    expect(calls.filter((c) => c.startsWith('consumaQuotaFoto'))).toEqual([]);
  });

  it('quando il modello fallisce la quota resta consumata', async () => {
    const { repo, quota } = fakeRepo();
    const h = leggiFotoWith(
      repo,
      async () => {
        throw new VisioneFallita('boom');
      },
      oggi,
      anno,
    );

    const r: any = await h(eventoFoto('AAAA'));
    expect(r.statusCode).toBe(502);
    // Altrimenti chi abusa ottiene tentativi gratis facendo fallire la lettura.
    expect(quota.get('2026-08-02')).toBe(1);
  });

  it('un estrazione che non supera la validazione e 422, non 500', async () => {
    const { repo } = fakeRepo();
    const h = leggiFotoWith(repo, async () => ({ mese: 99 }), oggi, anno);

    const r: any = await h(eventoFoto('AAAA'));
    expect(r.statusCode).toBe(422);
    expect(body(r).errore).toContain('leggere');
  });

  it('riga non trovata ha un messaggio suo', async () => {
    const { repo } = fakeRepo();
    const h = leggiFotoWith(
      repo,
      async () => ({ ...estrazioneAgosto(), trovata: false, nomeTrovato: null, rigaTrovata: null }),
      oggi,
      anno,
    );

    const r: any = await h(eventoFoto('AAAA'));
    expect(r.statusCode).toBe(422);
    expect(body(r).errore).toContain('Vanessa');
  });

  it('senza immagine e 400', async () => {
    const { repo } = fakeRepo();
    const h = leggiFotoWith(repo, async () => estrazioneAgosto(), oggi, anno);

    const r: any = await h(event({ body: JSON.stringify({}) }));
    expect(r.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `cd app && npx vitest run --root api api/test/handlers.test.ts`
Expected: FAIL — `leggiFotoWith` non è esportata.

- [ ] **Step 3: Aggiungi `requireImmagine` a `api/src/http.ts`**

In fondo, prima di `handle`:

```ts
/** Due megabyte. Un'immagine ridimensionata come si deve ne pesa meno di uno:
 *  oltre questa soglia non c'e' niente da leggere, c'e' solo da spendere. */
export const MAX_CORPO_BYTE = 2 * 1024 * 1024;

/** Il corpo e' troppo grande: 413, e la richiesta si ferma prima di costare. */
export class TroppoGrande extends Error {}

export function requireImmagine(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new InvalidInput('immagine: attesa l immagine in base64');
  }
  // La lunghezza in base64 e' una stima per eccesso dei byte: va benissimo,
  // il controllo serve a fermare l'enorme, non a misurare il giusto.
  if (v.length > MAX_CORPO_BYTE) throw new TroppoGrande('immagine troppo grande');
  return v;
}
```

E in `handle`, aggiungi il ramo prima di quello di `InvalidInput`:

```ts
export function handle(
  fn: () => Promise<APIGatewayProxyResultV2>,
): Promise<APIGatewayProxyResultV2> {
  return fn().catch((e: unknown) => {
    if (e instanceof TroppoGrande) return failure(413, e.message);
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
  FotoNonValida,
  MAX_LETTURE_AL_GIORNO,
  RigaNonTrovata,
  giornoRoma,
  validaEstrazione,
} from '@vanessa/core';
import type { IsoDate } from '@vanessa/core';

import type { Visione } from './visione.js';
import { VisioneFallita, creaVisione } from './visione.js';
```

e a quelli da `./http.js`: `failure`, `requireImmagine`.

Poi, dopo `putConfigWith`:

```ts
/** Legge una foto del foglio e restituisce quello che c'e' scritto.
 *
 * L'ordine dei tre passi e' la difesa: si rifiuta l'enorme prima di spendere,
 * si consuma la quota prima di chiamare il modello, e la quota NON si
 * restituisce se il modello fallisce — altrimenti chi abusa ottiene tentativi
 * gratis proprio facendo fallire la lettura.
 *
 * Non scrive nessun turno: il salvataggio resta su PUT /shifts, che ha gia'
 * la revisione di cosa verrebbe sovrascritto.
 */
export function leggiFotoWith(
  repo: Repo,
  visione: Visione,
  oggi: () => IsoDate = giornoRoma,
  anno: () => number = () => new Date().getFullYear(),
) {
  return (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> =>
    handle(async () => {
      const immagine = requireImmagine(parseJson(event.body).immagine);

      if (!(await repo.consumaQuotaFoto(oggi(), MAX_LETTURE_AL_GIORNO))) {
        return failure(
          429,
          `Hai gia' usato le ${MAX_LETTURE_AL_GIORNO} letture di oggi. Riprova domani, oppure scrivi i codici a mano.`,
        );
      }

      let grezzo: unknown;
      try {
        grezzo = await visione(immagine);
      } catch (e) {
        if (e instanceof VisioneFallita) {
          console.error('lettura fallita', e.message);
          return failure(502, 'Il servizio non risponde. Riprova fra un minuto.');
        }
        throw e;
      }

      try {
        return ok({ estrazione: validaEstrazione(grezzo, anno()) });
      } catch (e) {
        if (e instanceof RigaNonTrovata) {
          return failure(
            422,
            'Non ho trovato la riga di Vanessa in questa foto. Controlla che si veda tutta la riga, dal nome fino all ultimo giorno.',
          );
        }
        if (e instanceof FotoNonValida) {
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
export const leggiFoto = (e: APIGatewayProxyEventV2) =>
  leggiFotoWith(repoFromEnvironment(), creaVisione())(e);
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
- Produces: `AppStack.fotoUrl: string`, output CloudFormation `UrlFoto`.

- [ ] **Step 1: Scrivi i test che falliscono**

In `app/infra/test/stacks.test.ts`, dentro il file, aggiungi una `describe` nuova:

```ts
describe('lettura delle foto', () => {
  it('ha una Lambda con abbastanza tempo per una lettura', () => {
    app.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.leggiFoto',
      Timeout: 120,
      ReservedConcurrentExecutions: 2,
    });
  });

  it('sta dietro una Function URL, non dietro API Gateway', () => {
    app.hasResourceProperties('AWS::Lambda::Url', {
      AuthType: 'NONE',
      Cors: Match.objectLike({ AllowOrigins: ['https://vanessa.matteo.cool'] }),
    });
  });

  it('puo invocare il modello, e nient altro di Bedrock', () => {
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

  it('la tabella scade le righe del contatore', () => {
    app.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TimeToLiveSpecification: { AttributeName: 'scade', Enabled: true },
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
      // Solo le righe del contatore delle foto portano `scade`: i turni no,
      // e restano dove sono.
      timeToLiveAttribute: 'scade',
      removalPolicy: RemovalPolicy.RETAIN,
    });
```

Dichiara il campo pubblico accanto a `apiUrl`:

```ts
  readonly apiUrl: string;
  readonly fotoUrl: string;
```

Dopo `const putConfigFn = lambda('PutConfig', 'putConfig');`, aggiungi la Lambda della lettura. Non usa l'helper `lambda()` perché ha tempi, memoria e concorrenza tutti suoi:

```ts
    // Una lettura mette insieme ragionamento e visione: puo' prendere piu' dei
    // 30 secondi a cui API Gateway tronca l'integrazione. Da qui la Function
    // URL, che quel limite non ce l'ha. Le altre cinque rotte non si toccano.
    const leggiFotoFn = new NodejsFunction(this, 'LeggiFoto', {
      entry: HANDLERS,
      handler: 'leggiFoto',
      projectRoot: APP_ROOT,
      depsLockFilePath: API_LOCKFILE,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(120),
      // Senza il throttling di API Gateway, il freno al parallelismo e' questo.
      reservedConcurrentExecutions: 2,
      logGroup: new LogGroup(this, 'LeggiFotoLog', {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        TABLE_NAME: table.tableName,
        ALLOWED_ORIGIN: `https://${props.domain}`,
      },
      bundling: { format: undefined, minify: true, sourceMap: true },
    });

    // Scrive soltanto il contatore della quota, ma la tabella e' una sola.
    table.grantReadWriteData(leggiFotoFn);

    leggiFotoFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-opus-5`],
      }),
    );

    const fotoFunctionUrl = leggiFotoFn.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: [`https://${props.domain}`],
        allowedMethods: [LambdaHttpMethod.POST],
        allowedHeaders: ['content-type'],
        maxAge: Duration.hours(1),
      },
    });
    this.fotoUrl = fotoFunctionUrl.url;
```

E fra gli output, accanto a `UrlApi`:

```ts
    new CfnOutput(this, 'UrlFoto', { value: fotoFunctionUrl.url });
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
- Create: `app/web/src/immagine.ts`
- Create: `app/web/test/immagine.test.ts`
- Modify: `app/web/src/api.ts`
- Modify: `app/web/.env.production`

**Interfaces:**
- Produces:
  - `LATO_MASSIMO = 2576`, `scalaPer(larghezza: number, altezza: number): number`, `ridimensiona(file: File): Promise<string>` da `immagine.js`
  - `FOTO_URL: string` e `Api.leggiFoto(immagine: string): Promise<EstrazioneFoto>` da `api.js`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `app/web/test/immagine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { LATO_MASSIMO, scalaPer } from '../src/immagine.js';

describe('scalaPer', () => {
  it('non ingrandisce mai una foto gia piccola', () => {
    expect(scalaPer(800, 600)).toBe(1);
  });

  it('porta il lato lungo al massimo, orizzontale o verticale che sia', () => {
    expect(scalaPer(4032, 3024) * 4032).toBeCloseTo(LATO_MASSIMO);
    expect(scalaPer(3024, 4032) * 4032).toBeCloseTo(LATO_MASSIMO);
  });

  it('e esattamente il massimo quando la foto e gia di quella misura', () => {
    expect(scalaPer(LATO_MASSIMO, 1000)).toBe(1);
  });
});
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `cd app && npx vitest run --root web web/test/immagine.test.ts`
Expected: FAIL — `../src/immagine.js` non esiste.

- [ ] **Step 3: Scrivi `web/src/immagine.ts`**

```ts
/** Ridimensionamento della foto, prima di spedirla.
 *
 * 2576 px sul lato lungo e' il massimo che il modello usa comunque: mandare
 * una foto da dodici megapixel non aggiunge un solo dettaglio letto, aggiunge
 * solo byte da caricare con la rete del telefono.
 *
 * Il calcolo della scala sta separato dal disegno su canvas perche' e' l'unica
 * parte che si puo' provare senza un browser vero: jsdom non ha ne canvas ne
 * createImageBitmap.
 */

export const LATO_MASSIMO = 2576;

export function scalaPer(larghezza: number, altezza: number): number {
  return Math.min(1, LATO_MASSIMO / Math.max(larghezza, altezza));
}

/** La foto come base64, senza il prefisso data:. */
export async function ridimensiona(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scala = scalaPer(bitmap.width, bitmap.height);
    const w = Math.round(bitmap.width * scala);
    const h = Math.round(bitmap.height * scala);

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

Run: `cd app && npx vitest run --root web web/test/immagine.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Aggiungi `leggiFoto` a `web/src/api.ts`**

Agli import di tipo aggiungi `EstrazioneFoto`:

```ts
import type { EstrazioneFoto, IsoDate, PaySettings, ShiftCode } from '@vanessa/core';
```

Sotto `API_URL`:

```ts
/** La lettura delle foto sta su una Function URL a se': API Gateway tronca
 *  l'integrazione a 30 secondi e una lettura ne puo' prendere di piu'. */
export const FOTO_URL: string = import.meta.env.VITE_FOTO_URL ?? '';
```

Aggiungi alla `interface Api`:

```ts
  leggiFoto(immagine: string): Promise<EstrazioneFoto>;
```

E all'oggetto `api`:

```ts
  async leggiFoto(immagine) {
    const r = await fetch(FOTO_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ immagine }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      let message = `lettura fallita (${r.status})`;
      try {
        const j = JSON.parse(text) as { errore?: string };
        if (j.errore) message = j.errore;
      } catch {
        /* il corpo non era JSON: resta il messaggio generico */
      }
      throw new Error(message);
    }
    const j = (await r.json()) as { estrazione: EstrazioneFoto };
    return j.estrazione;
  },
```

- [ ] **Step 6: Aggiungi la variabile a `web/.env.production`**

```
VITE_FOTO_URL=https://DA-COMPILARE.lambda-url.eu-south-1.on.aws/
```

Il valore vero è l'output `UrlFoto` dello stack: si legge dopo il primo deploy con
`aws cloudformation describe-stacks --stack-name VanessaApp --query "Stacks[0].Outputs[?OutputKey=='UrlFoto'].OutputValue" --output text --region eu-south-1`
e si incolla qui **prima** di ricompilare il frontend.

- [ ] **Step 7: Esegui tutti i test**

Run: `cd app && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/web/src/immagine.ts app/web/test/immagine.test.ts app/web/src/api.ts app/web/.env.production
git commit -m "feat: ridimensionamento della foto e chiamata alla Function URL"
```

---

### Task 7: estrai `PianoSalvataggio` da `BulkEntry`

Rifattorizzazione pura: nessun comportamento nuovo. I test esistenti di `BulkEntry` devono passare senza essere toccati — è quello che dimostra che la rifattorizzazione è tale.

**Files:**
- Create: `app/web/src/PianoSalvataggio.tsx`
- Modify: `app/web/src/BulkEntry.tsx`

**Interfaces:**
- Consumes: `ParsedEntry`, `IsoDate`, `ShiftCode`, `MONTH_NAMES`, `planChanges` da `@vanessa/core`.
- Produces:

```ts
export interface PianoSalvataggioProps {
  entries: readonly ParsedEntry[];
  existing: ReadonlyMap<IsoDate, ShiftCode>;
  month: number;
  /** Giorni del mese senza turno: mostrati nel riepilogo, non salvati. */
  senzaTurno?: number;
  /** Blocca il salvataggio quando l'input a monte non e' valido. */
  bloccato?: boolean;
  onSave: (entries: readonly { date: IsoDate; code: ShiftCode }[]) => Promise<void>;
  /** Chiamato dopo un salvataggio riuscito, per ripulire la sorgente. */
  onSaved?: () => void;
}
```

- [ ] **Step 1: Verifica il punto di partenza**

Run: `cd app && npx vitest run --root web`
Expected: PASS. Prendi nota di quanti test sono: alla fine devono essere gli stessi, tutti verdi.

- [ ] **Step 2: Crea `web/src/PianoSalvataggio.tsx`**

```tsx
/** Cosa succederebbe salvando, e il pulsante per farlo.
 *
 * Sta in un componente suo perche' due strade portano qui — la sequenza
 * scritta a mano e la foto — e la revisione prima di sovrascrivere e'
 * esattamente la parte che non deve dipendere da come si e' arrivati.
 */

import { useMemo, useState } from 'react';

import type { IsoDate, ParsedEntry, ShiftCode } from '@vanessa/core';
import { MONTH_NAMES, planChanges } from '@vanessa/core';

export interface PianoSalvataggioProps {
  entries: readonly ParsedEntry[];
  existing: ReadonlyMap<IsoDate, ShiftCode>;
  month: number;
  senzaTurno?: number;
  bloccato?: boolean;
  onSave: (entries: readonly { date: IsoDate; code: ShiftCode }[]) => Promise<void>;
  onSaved?: () => void;
}

export function PianoSalvataggio({
  entries,
  existing,
  month,
  senzaTurno = 0,
  bloccato = false,
  onSave,
  onSaved,
}: PianoSalvataggioProps) {
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

      {plan.length > 0 && !bloccato && (
        <>
          <p className="summary-line">
            <strong>{created.length}</strong> giorni nuovi ·{' '}
            <strong>{changed.length}</strong> da sovrascrivere ·{' '}
            {plan.length - created.length - changed.length} già così
            {senzaTurno > 0 && <> · {senzaTurno} senza turno</>}
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
 * PianoSalvataggio, shared with the photo import.
 */

import { useMemo, useState } from 'react';

import type { IsoDate, ShiftCode } from '@vanessa/core';
import { MONTH_NAMES, parseSequence } from '@vanessa/core';

import { PianoSalvataggio } from './PianoSalvataggio.js';

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

      <PianoSalvataggio
        entries={parsed.entries}
        existing={existing}
        month={month}
        bloccato={blocked}
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
git add app/web/src/PianoSalvataggio.tsx app/web/src/BulkEntry.tsx
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
- Consumes: `EstrazioneFoto`, `GiornoLetto`, `vociDaEstrazione`, `SHIFTS`, `MONTH_NAMES`, `toIso`, `weekday` da `@vanessa/core`; `ridimensiona` da `./immagine.js`; `PianoSalvataggio` da `./PianoSalvataggio.js`.
- Produces:

```ts
export interface PhotoImportProps {
  year: number;
  existing: ReadonlyMap<IsoDate, ShiftCode>;
  onLeggi: (immagine: string) => Promise<EstrazioneFoto>;
  onSave: (entries: readonly { date: IsoDate; code: ShiftCode }[]) => Promise<void>;
}
```

- [ ] **Step 1: Scrivi i test che falliscono**

Crea `app/web/test/photoImport.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { EstrazioneFoto, IsoDate, ShiftCode } from '@vanessa/core';

import { PhotoImport } from '../src/PhotoImport.js';

/** Luglio come sta sulla foto: niente fino al 16, poi quindici turni. */
const LUGLIO: readonly (ShiftCode | null)[] = [
  ...Array<null>(16).fill(null),
  'M','M','P','L','P','M','M','M','L','P','M','M','M','L','P',
];

function estrazioneLuglio(incerti: readonly number[] = []): EstrazioneFoto {
  return {
    mese: 7,
    anno: 2026,
    trovata: true,
    nomeTrovato: 'Vanessa',
    rigaTrovata: 14,
    giorni: LUGLIO.map((codice, i) => ({
      giorno: i + 1,
      codice,
      sicuro: !incerti.includes(i + 1),
    })),
  };
}

/** jsdom non ha canvas ne createImageBitmap: il ridimensionamento vero si
 *  prova su un browser. Sostituendo il modulo, il test entra dal file input
 *  come ci entra Vanessa, invece di scavalcare il componente da dentro. */
vi.mock('../src/immagine.js', () => ({
  LATO_MASSIMO: 2576,
  scalaPer: () => 1,
  ridimensiona: () => Promise.resolve('AAAA'),
}));

async function renderCon(
  estrazione: EstrazioneFoto,
  existing = new Map<IsoDate, ShiftCode>(),
) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onLeggi = vi.fn().mockResolvedValue(estrazione);
  render(<PhotoImport year={2026} existing={existing} onLeggi={onLeggi} onSave={onSave} />);

  await userEvent.upload(
    screen.getByLabelText(/Leggi da una foto/i),
    new File(['finta'], 'foglio.jpeg', { type: 'image/jpeg' }),
  );
  return { onSave, onLeggi };
}

describe('PhotoImport', () => {
  it('mostra il mese e la riga che ha trovato', async () => {
    await renderCon(estrazioneLuglio());
    expect(await screen.findByText(/Luglio 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/Vanessa/)).toBeInTheDocument();
  });

  it('conta i giorni senza turno invece di salvarli', async () => {
    await renderCon(estrazioneLuglio());
    expect(await screen.findByText(/16 senza turno/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salva 15 giorni/ })).toBeInTheDocument();
  });

  it('salva solo i giorni con un turno, a partire dal 17', async () => {
    const { onSave } = await renderCon(estrazioneLuglio());
    await userEvent.click(await screen.findByRole('button', { name: /Salva 15 giorni/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const inviati = onSave.mock.calls[0][0];
    expect(inviati).toHaveLength(15);
    expect(inviati[0]).toEqual({ date: '2026-07-17', code: 'M' });
  });

  it('segna le celle che il modello non ha letto con sicurezza', async () => {
    await renderCon(estrazioneLuglio([23]));
    const cella = await screen.findByRole('button', { name: /^23 / });
    expect(cella).toHaveClass('incerto');
  });

  it('correggere una cella cambia quello che verrebbe salvato', async () => {
    const { onSave } = await renderCon(estrazioneLuglio([23]));

    await userEvent.click(await screen.findByRole('button', { name: /^23 / }));
    await userEvent.click(screen.getByRole('button', { name: /^P1/ }));
    await userEvent.click(screen.getByRole('button', { name: /Salva 15 giorni/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const inviati = onSave.mock.calls[0][0];
    expect(inviati.find((s: any) => s.date === '2026-07-23')).toEqual({
      date: '2026-07-23',
      code: 'P1',
    });
  });

  it('si puo togliere il turno da un giorno, e allora non si salva', async () => {
    const { onSave } = await renderCon(estrazioneLuglio());

    await userEvent.click(await screen.findByRole('button', { name: /^17 / }));
    await userEvent.click(screen.getByRole('button', { name: /Nessun turno/i }));
    await userEvent.click(screen.getByRole('button', { name: /Salva 14 giorni/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const inviati = onSave.mock.calls[0][0];
    expect(inviati).toHaveLength(14);
    expect(inviati.find((s: any) => s.date === '2026-07-17')).toBeUndefined();
  });

  it('avvisa quando i giorni verrebbero sovrascritti', async () => {
    const existing = new Map<IsoDate, ShiftCode>([['2026-07-17', 'L']]);
    await renderCon(estrazioneLuglio(), existing);
    expect(await screen.findByText(/1 da sovrascrivere/)).toBeInTheDocument();
  });

  it('rifiuta una foto di un altro anno invece di salvare date sbagliate', async () => {
    await renderCon({ ...estrazioneLuglio(), anno: 2025 });
    expect(await screen.findByRole('alert')).toHaveTextContent(/2025/);
    expect(screen.queryByRole('button', { name: /^Salva/ })).not.toBeInTheDocument();
  });

  it('si puo correggere il mese, e i giorni seguono', async () => {
    const { onSave } = await renderCon(estrazioneLuglio());

    // Se il modello avesse letto il titolo sbagliato, rifotografare non
    // servirebbe: leggerebbe di nuovo lo stesso. Il mese deve essere correggibile.
    await userEvent.selectOptions(screen.getByLabelText(/Mese/i), '6');
    await userEvent.click(screen.getByRole('button', { name: /Salva 15 giorni/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0][0]).toEqual({ date: '2026-06-17', code: 'M' });
  });

  it('passando a un mese piu corto i giorni in eccesso spariscono', async () => {
    const { onSave } = await renderCon(estrazioneLuglio());

    // Luglio ha 31 giorni, febbraio 28: il 29, 30 e 31 non esistono piu'.
    // Dei quindici turni di luglio, i tre ultimi cadono li'.
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
 * La griglia e' modificabile per intero, non solo dove il modello si e'
 * dichiarato incerto: l'errore tipico di una lettura e' una cella sola, e
 * chi la vede sbagliata deve poterla correggere anche quando il modello era
 * convinto del contrario.
 */

import { useMemo, useState } from 'react';

import type { EstrazioneFoto, IsoDate, ShiftCode } from '@vanessa/core';
import { MONTH_NAMES, SHIFTS, daysInMonth, toIso, weekday } from '@vanessa/core';

import { PianoSalvataggio } from './PianoSalvataggio.js';
import { ridimensiona } from './immagine.js';

export interface PhotoImportProps {
  year: number;
  existing: ReadonlyMap<IsoDate, ShiftCode>;
  onLeggi: (immagine: string) => Promise<EstrazioneFoto>;
  onSave: (entries: readonly { date: IsoDate; code: ShiftCode }[]) => Promise<void>;
}

interface Letta {
  mese: number;
  anno: number;
  nome: string;
  riga: number | null;
  codici: (ShiftCode | null)[];
  incerti: Set<number>;
}

function daEstrazione(e: EstrazioneFoto): Letta {
  const codici: (ShiftCode | null)[] = Array(daysInMonth(e.anno, e.mese)).fill(null);
  const incerti = new Set<number>();
  for (const g of e.giorni) {
    codici[g.giorno - 1] = g.codice;
    if (!g.sicuro) incerti.add(g.giorno);
  }
  return { mese: e.mese, anno: e.anno, nome: e.nomeTrovato ?? '', riga: e.rigaTrovata, codici, incerti };
}

export function PhotoImport({ year, existing, onLeggi, onSave }: PhotoImportProps) {
  const [letta, setLetta] = useState<Letta | null>(null);
  const [leggendo, setLeggendo] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [aperto, setAperto] = useState<number | null>(null);

  const scegli = async (file: File | undefined) => {
    if (!file) return;
    setLeggendo(true);
    setErrore(null);
    try {
      setLetta(daEstrazione(await onLeggi(await ridimensiona(file))));
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setLeggendo(false);
    }
  };

  const entries = useMemo(() => {
    if (!letta) return [];
    const out: { date: IsoDate; day: number; code: ShiftCode }[] = [];
    letta.codici.forEach((code, i) => {
      if (code) out.push({ date: toIso(letta.anno, letta.mese, i + 1), day: i + 1, code });
    });
    return out;
  }, [letta]);

  /** Il mese letto dal titolo puo' essere sbagliato, e rifotografare non
   *  aiuterebbe: il modello leggerebbe di nuovo lo stesso titolo. Cambiandolo,
   *  la griglia si accorcia o si allunga — un mese piu' corto perde i giorni
   *  che non esistono, uno piu' lungo li aggiunge vuoti. */
  const cambiaMese = (mese: number) => {
    setLetta((l) => {
      if (!l) return l;
      const quanti = daysInMonth(l.anno, mese);
      const codici = Array.from({ length: quanti }, (_, i) => l.codici[i] ?? null);
      const incerti = new Set([...l.incerti].filter((g) => g <= quanti));
      return { ...l, mese, codici, incerti };
    });
    setAperto(null);
  };

  const cambia = (giorno: number, code: ShiftCode | null) => {
    setLetta((l) => {
      if (!l) return l;
      const codici = [...l.codici];
      codici[giorno - 1] = code;
      // Corretta a mano: non e' piu' incerta, comunque vada.
      const incerti = new Set(l.incerti);
      incerti.delete(giorno);
      return { ...l, codici, incerti };
    });
    setAperto(null);
  };

  // La app copre un anno solo: date di un altro anno non troverebbero nulla
  // con cui confrontarsi, e si salverebbero fuori dal calendario che si vede.
  const annoSbagliato = letta !== null && letta.anno !== year;

  return (
    <div className="foto">
      {!letta && (
        <>
          <label className="foto-scegli">
            <span aria-hidden="true">📷</span> Leggi da una foto
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={leggendo}
              onChange={(e) => void scegli(e.target.files?.[0])}
            />
          </label>
          {leggendo && <p className="waiting">Leggo la foto… ci vuole qualche secondo.</p>}
        </>
      )}

      {errore && (
        <p className="error" role="alert">
          {errore}
        </p>
      )}

      {letta && (
        <>
          <div className="foto-testa">
            <label>
              <span>Mese</span>
              <select value={letta.mese} onChange={(e) => cambiaMese(Number(e.target.value))}>
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name} {letta.anno}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              riga trovata: {letta.nome}
              {letta.riga !== null && ` (${letta.riga})`}
            </p>
            <button
              type="button"
              className="toggle"
              onClick={() => {
                setLetta(null);
                setErrore(null);
              }}
            >
              ripeti con un altra foto
            </button>
          </div>

          {annoSbagliato ? (
            <p className="error" role="alert">
              Questa foto è del {letta.anno}, ma l&apos;app tiene i turni del {year}. Non la
              posso caricare qui.
            </p>
          ) : (
            <>
              <div className="foto-grid" role="group" aria-label="Giorni letti dalla foto">
                {letta.codici.map((code, i) => {
                  const giorno = i + 1;
                  const wd = weekday(toIso(letta.anno, letta.mese, giorno));
                  return (
                    <button
                      key={giorno}
                      type="button"
                      style={giorno === 1 ? { gridColumnStart: wd + 1 } : undefined}
                      className={[
                        'foto-cella',
                        code ? `t-${code}` : 'vuota',
                        letta.incerti.has(giorno) ? 'incerto' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-label={`${giorno} ${code ?? 'nessun turno'}`}
                      onClick={() => setAperto(giorno)}
                    >
                      <span className="day-number">{giorno}</span>
                      <span className="code">{code ?? '–'}</span>
                    </button>
                  );
                })}
              </div>

              <PianoSalvataggio
                entries={entries}
                existing={existing}
                month={letta.mese}
                senzaTurno={letta.codici.filter((c) => c === null).length}
                onSave={onSave}
              />
            </>
          )}
        </>
      )}

      {aperto !== null && letta && (
        <div className="sheet" role="dialog" aria-label={`Giorno ${aperto}`}>
          <div className="sheet-head">
            <strong>
              {aperto} {MONTH_NAMES[letta.mese - 1]}
            </strong>
            <button type="button" onClick={() => setAperto(null)}>
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
                    letta.codici[aperto - 1] === s.code ? 'on' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => cambia(aperto, s.code)}
                >
                  {s.code}
                  <span>{s.description}</span>
                </button>
              ))}
            </div>
            <button type="button" className="toggle" onClick={() => cambia(aperto, null)}>
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
.foto-scegli {
  display: flex; align-items: center; justify-content: center; gap: 0.5rem;
  min-height: var(--tap); border: 1px dashed var(--navy); border-radius: 10px;
  color: var(--navy); font-weight: 700; cursor: pointer; margin: 0.6rem 0;
}
.foto-scegli input { display: none; }
.foto-testa { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
.foto-testa h3 { margin: 0.4rem 0; }
.foto-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin: 0.5rem 0; }
.foto-cella {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: var(--tap); border: 1px solid var(--border); border-radius: 6px;
  background: #fff; padding: 0;
}
.foto-cella.vuota { background: var(--bg); color: var(--muted); }
.foto-cella.t-M { background: var(--M); }
.foto-cella.t-M1 { background: var(--M1); }
.foto-cella.t-P { background: var(--P); }
.foto-cella.t-P1 { background: var(--P1); }
.foto-cella.t-L { background: var(--L); }
/* Il modello non era sicuro: si guarda, non si blocca. */
.foto-cella.incerto .code { text-decoration: underline dashed; text-underline-offset: 2px; }
```

- [ ] **Step 5: Esegui i test e verifica che passino**

Run: `cd app && npx vitest run --root web web/test/photoImport.test.tsx`
Expected: PASS (8 test).

- [ ] **Step 6: Innesta nella vista Carica**

In `web/src/BulkEntry.tsx`, aggiungi alle props:

```ts
  onLeggiFoto: (immagine: string) => Promise<import('@vanessa/core').EstrazioneFoto>;
```

importa `PhotoImport`, e mettilo subito sotto `<h2>Caricamento rapido</h2>`, prima della nota:

```tsx
      <PhotoImport year={year} existing={existing} onLeggi={onLeggiFoto} onSave={onSave} />

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
            onLeggiFoto={api.leggiFoto}
          />
```

Nei test già esistenti che costruiscono un `Api` finto (`web/test/app.test.tsx`), aggiungi il metodo mancante:

```ts
  async leggiFoto() {
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
- Create: `app/api/test/visione.integrazione.test.ts`
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

Crea `app/api/test/visione.integrazione.test.ts`:

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
 *   npx vitest run --root api api/test/visione.integrazione.test.ts
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { validaEstrazione, vociDaEstrazione } from '@vanessa/core';

import { creaVisione } from '../src/visione.js';

const attivo =
  process.env.PROVA_BEDROCK === '1' && !!process.env.FOTO_LUGLIO && !!process.env.FOTO_AGOSTO;

const LUGLIO = ['M','M','P','L','P','M','M','M','L','P','M','M','M','L','P'];
const AGOSTO = [
  'L','M','M','M','P','L','M','L','M','P1','L','M','P','M','P','M1',
  'L','M','P','L','M','P','M','P','L','M','P','M','P','L','M',
];

function base64(percorso: string): string {
  return readFileSync(percorso).toString('base64');
}

describe.runIf(attivo)('lettura delle foto vere', () => {
  const visione = creaVisione();

  it('agosto: il mese intero', { timeout: 180_000 }, async () => {
    const e = validaEstrazione(await visione(base64(process.env.FOTO_AGOSTO!)), 2026);
    expect(e.mese).toBe(8);
    expect(e.anno).toBe(2026);
    expect(vociDaEstrazione(e).map((v) => v.code)).toEqual(AGOSTO);
  });

  it('luglio: le x fino al 16, poi quindici turni', { timeout: 180_000 }, async () => {
    const e = validaEstrazione(await visione(base64(process.env.FOTO_LUGLIO!)), 2026);
    expect(e.mese).toBe(7);
    const voci = vociDaEstrazione(e);
    expect(voci[0].day).toBe(17);
    expect(voci.map((v) => v.code)).toEqual(LUGLIO);
  });
});
```

- [ ] **Step 3: Esegui il test senza le variabili e verifica che si salti**

Run: `cd app && npx vitest run --root api api/test/visione.integrazione.test.ts`
Expected: 0 test eseguiti, nessun fallimento (la suite è saltata).

- [ ] **Step 4: Esegui il test con le foto vere**

Run:
```bash
cd app && PROVA_BEDROCK=1 \
  FOTO_LUGLIO=$HOME/vanessa-foto/luglio.jpeg \
  FOTO_AGOSTO=$HOME/vanessa-foto/agosto.jpeg \
  npx vitest run --root api api/test/visione.integrazione.test.ts
```
Expected: 2 test PASS.

Se un test fallisce, la differenza dice cosa il modello ha sbagliato. Prima di cambiare le attese, controlla la foto: le attese qui sono trascrizioni verificate a mano, e sono loro la verità. Se serve, lavora sul `PROMPT` in `api/src/visione.ts` — non sulle attese.

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
l'output `UrlFoto` dello stack e va in `web/.env.production` come
`VITE_FOTO_URL` prima di ricompilare il frontend.

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
  npx vitest run --root api api/test/visione.integrazione.test.ts
```
```

- [ ] **Step 6: Esegui tutto**

Run: `cd app && npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/test/visione.integrazione.test.ts app/README.md
git commit -m "test: le due foto vere contro Bedrock, e la documentazione"
```

---

## Dopo il merge: il primo deploy

1. `git push` su `main` lancia la pipeline, che distribuisce lo stack.
2. Leggi l'indirizzo della Function URL:
   ```bash
   aws cloudformation describe-stacks --stack-name VanessaApp --region eu-south-1 \
     --query "Stacks[0].Outputs[?OutputKey=='UrlFoto'].OutputValue" --output text
   ```
3. Incollalo in `app/web/.env.production` come `VITE_FOTO_URL`, committa, e lascia che la pipeline ricompili il frontend. **Finché questo passo manca, il pulsante della foto chiama una stringa vuota e fallisce.**
4. Prova una lettura vera dal telefono. Se torna `AccessDeniedException`, il messaggio nomina l'azione IAM che manca: aggiungila al `PolicyStatement` di `LeggiFoto` (Task 5, Step 7) e ridistribuisci.
5. Metti un allarme di budget sull'account, se non c'è già.
