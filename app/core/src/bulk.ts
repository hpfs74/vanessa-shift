/** Bulk entry: a month plus a sequence of codes.
 *
 * The point of this screen is typing a whole month at once, so it must be
 * forgiving about separators and about case, and unforgiving about anything
 * it cannot understand: a silently skipped code would land a shift on the
 * wrong day and shift every day after it.
 */

import type { ShiftCode } from './shifts.js';
import { isShiftCode } from './shifts.js';
import { type IsoDate, daysInMonth, toIso } from './dates.js';

export interface ParsedEntry {
  readonly date: IsoDate;
  readonly day: number;
  readonly code: ShiftCode;
}

export interface BulkParse {
  readonly entries: readonly ParsedEntry[];
  /** Tokens that are not a known code, with the position they came from. */
  readonly unknown: readonly { readonly position: number; readonly token: string }[];
  /** True when more codes were given than the month has days. */
  readonly tooMany: boolean;
  readonly daysInMonth: number;
}

/** Splits on commas, spaces, semicolons, tabs and newlines alike. */
export function tokenise(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function parseSequence(year: number, month: number, text: string): BulkParse {
  const total = daysInMonth(year, month);
  const tokens = tokenise(text);
  const entries: ParsedEntry[] = [];
  const unknown: { position: number; token: string }[] = [];

  tokens.forEach((token, i) => {
    // Typing is done in a hurry: "m1" and "M1" are the same shift.
    const code = token.toUpperCase();
    if (!isShiftCode(code)) {
      unknown.push({ position: i + 1, token });
      return;
    }
    const day = i + 1;
    if (day > total) return;
    entries.push({ date: toIso(year, month, day), day, code });
  });

  return {
    entries,
    unknown,
    tooMany: tokens.length > total,
    daysInMonth: total,
  };
}

export interface BulkChange {
  readonly date: IsoDate;
  readonly day: number;
  readonly code: ShiftCode;
  readonly previous: ShiftCode | null;
  readonly kind: 'new' | 'changed' | 'same';
}

/** What the sequence would actually do, so it can be shown before saving.
 *  Overwriting a month by accident is the one irreversible mistake here. */
export function planChanges(
  entries: readonly ParsedEntry[],
  existing: ReadonlyMap<IsoDate, ShiftCode>,
): BulkChange[] {
  return entries.map((e) => {
    const previous = existing.get(e.date) ?? null;
    const kind = previous === null ? 'new' : previous === e.code ? 'same' : 'changed';
    return { ...e, previous, kind };
  });
}
