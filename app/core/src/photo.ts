/** Import from a photo of the shift sheet.
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
  /** The name as it is written on the sheet, and the row number when the sheet
   *  shows one. Both are captions: nothing downstream computes with them. */
  readonly foundName: string;
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

  if (e.found !== true) throw new RowNotFound(`no row for ${ROW_NAME}`);

  const month = integer(e.month, 'month');
  if (month < 1 || month > 12) throw new InvalidReading('month: out of 1-12');

  const year = integer(e.year, 'year');
  if (Math.abs(year - expectedYear) > 1) throw new InvalidReading('year: too far off');

  if (typeof e.foundName !== 'string' || e.foundName.length === 0) {
    throw new InvalidReading('foundName: expected a name');
  }
  // A photo cropped so the row number is not visible is still a readable
  // photo: the all-or-nothing rule is about `days`, not about a caption.
  const foundRow = e.foundRow === null ? null : integer(e.foundRow, 'foundRow');

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
