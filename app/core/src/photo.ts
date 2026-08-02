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
    throw new InvalidReading(`${field}: atteso un intero`);
  }
  return v;
}

export function validateReading(v: unknown, expectedYear: number): PhotoReading {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new InvalidReading('estrazione: atteso un oggetto');
  }
  const e = v as Record<string, unknown>;

  if (e.found !== true) throw new RowNotFound(`riga di ${ROW_NAME} non trovata`);

  const month = integer(e.month, 'mese');
  if (month < 1 || month > 12) throw new InvalidReading('mese: fuori da 1-12');

  const year = integer(e.year, 'anno');
  if (Math.abs(year - expectedYear) > 1) throw new InvalidReading('anno: troppo lontano');

  if (typeof e.foundName !== 'string' || e.foundName.length === 0) {
    throw new InvalidReading('nomeTrovato: atteso un nome');
  }
  const foundRow = integer(e.foundRow, 'rigaTrovata');

  if (!Array.isArray(e.days)) throw new InvalidReading('giorni: atteso un elenco');
  const expected = daysInMonth(year, month);
  if (e.days.length !== expected) {
    throw new InvalidReading(`giorni: attesi ${expected}, ricevuti ${e.days.length}`);
  }

  const seen = new Set<number>();
  const days: ReadDay[] = e.days.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new InvalidReading(`giorni[${i}]: atteso un oggetto`);
    }
    const g = raw as Record<string, unknown>;
    const day = integer(g.day, `giorni[${i}].giorno`);
    if (day < 1 || day > expected) {
      throw new InvalidReading(`giorni[${i}].giorno: ${day} non e nel mese`);
    }
    // The same day twice would mean that one column was read twice and
    // another never: the grid is not aligned.
    if (seen.has(day)) throw new InvalidReading(`giorno ${day} compare due volte`);
    seen.add(day);

    const code = g.code;
    if (code !== null && !isShiftCode(code)) {
      throw new InvalidReading(`giorni[${i}].codice: codice turno sconosciuto`);
    }
    if (typeof g.confident !== 'boolean') {
      throw new InvalidReading(`giorni[${i}].sicuro: atteso un booleano`);
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
