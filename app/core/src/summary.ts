/** Monthly summary: counts per code, worked days, total hours.
 *  Mirrors the Riepilogo sheet. */

import type { DayEntry, ShiftCode } from './shifts.js';
import { SHIFTS, entryHours } from './shifts.js';
import type { IsoDate } from './dates.js';
import { parseIso } from './dates.js';

export interface MonthSummary {
  readonly month: number;
  readonly perCode: Record<ShiftCode, number>;
  readonly workedDays: number;
  readonly totalHours: number;
}

const emptyPerCode = (): Record<ShiftCode, number> =>
  Object.fromEntries(SHIFTS.map((s) => [s.code, 0])) as Record<ShiftCode, number>;

export function yearSummary(
  year: number,
  days: ReadonlyMap<IsoDate, DayEntry>,
): MonthSummary[] {
  const months: MonthSummary[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    perCode: emptyPerCode(),
    workedDays: 0,
    totalHours: 0,
  }));

  for (const [date, entry] of days) {
    const { year: y, month } = parseIso(date);
    if (y !== year) continue;
    const m = months[month - 1]! as {
      perCode: Record<ShiftCode, number>;
      workedDays: number;
      totalHours: number;
    };
    m.perCode[entry.code] += 1;
    const h = entryHours(entry);
    if (h > 0) {
      m.workedDays += 1;
      m.totalHours += h;
    }
  }

  return months;
}

export function summaryTotals(months: readonly MonthSummary[]): {
  perCode: Record<ShiftCode, number>;
  workedDays: number;
  totalHours: number;
} {
  const perCode = emptyPerCode();
  let workedDays = 0;
  let totalHours = 0;
  for (const m of months) {
    for (const s of SHIFTS) perCode[s.code] += m.perCode[s.code];
    workedDays += m.workedDays;
    totalHours += m.totalHours;
  }
  return { perCode, workedDays, totalHours };
}
