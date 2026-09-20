/** The other people on the sheet: who is in the ward on the same day.
 *
 * The rule here is deliberately the opposite of `photo.ts`. There a
 * half-plausible grid is worse than an error, because it is saved as her own
 * hours. Here a row belongs to somebody else and nothing computes with it, so
 * a row read badly must cost that row — never the import.
 */

import { daysInMonth, parseIso, type IsoDate } from './dates.js';
import { ROW_NAME } from './photo.js';
import { isShiftCode, shift } from './shifts.js';
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
