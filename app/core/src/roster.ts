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
