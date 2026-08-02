/** Shift swaps: who owes whom a favour, and how many hours.
 *
 * Mirrors the Scambi sheet. Everything is derived from the day records —
 * there is no separate colleague list to keep in step.
 *
 * Swap kinds stay in Italian: Vanessa reads and picks them.
 */

import type { ShiftCode } from './shifts.js';
import { entryHours, hours } from './shifts.js';
import type { IsoDate } from './dates.js';

export const SWAP_KINDS = ['Ho coperto', 'Mi ha coperto', 'Scambio pari'] as const;
export type SwapKind = (typeof SWAP_KINDS)[number];

/** +1 = she owes me a favour, -1 = I owe her, 0 = even. */
export const SWAP_SIGN: Record<SwapKind, number> = {
  'Ho coperto': 1,
  'Mi ha coperto': -1,
  'Scambio pari': 0,
};

export function isSwapKind(v: unknown): v is SwapKind {
  return typeof v === 'string' && (SWAP_KINDS as readonly string[]).includes(v);
}

export interface DayRecord {
  readonly date: IsoDate;
  readonly code: ShiftCode;
  readonly hoursOverride?: number | null;
  readonly originalCode?: ShiftCode | null;
  readonly colleague?: string | null;
  readonly swapKind?: string | null;
  readonly notes?: string | null;
}

/** Hours actually worked minus hours originally rostered.
 *  Positive = worked more than planned, a credit towards the colleague.
 *
 *  "Actually worked" means the override when there is one: that is the whole
 *  point of overriding, and a credit computed from the shift's nominal hours
 *  would contradict what the calendar shows for the same day. */
export function hoursDelta(d: DayRecord): number {
  if (!d.originalCode) return 0;
  return entryHours(d) - hours(d.originalCode);
}

export interface ColleagueBalance {
  readonly colleague: string;
  /** How many times per swap kind. */
  readonly counts: Record<SwapKind, number>;
  /** Covered by me minus covered by her. Positive = she owes me. */
  readonly favourBalance: number;
  /** Sum of the hour deltas. Positive = credit towards her. */
  readonly hoursBalance: number;
}

export interface SwapReport {
  readonly balances: readonly ColleagueBalance[];
  /** Days marked as a swap in total. */
  readonly recorded: number;
  /** Of those, how many carry a colleague name. */
  readonly named: number;
  /** Swaps with no colleague attached: they belong to nobody's balance. */
  readonly unattributed: number;
}

const emptyCounts = (): Record<SwapKind, number> => ({
  'Ho coperto': 0,
  'Mi ha coperto': 0,
  'Scambio pari': 0,
});

/** A colleague typed as " giulia " and "Giulia" is the same person. */
export function normaliseColleague(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function sortKey(name: string): string {
  return name.toLocaleLowerCase('it');
}

export function swapReport(days: readonly DayRecord[]): SwapReport {
  const byColleague = new Map<string, { display: string; counts: Record<SwapKind, number>; hours: number }>();
  let recorded = 0;
  let named = 0;

  for (const d of days) {
    if (!d.swapKind || !isSwapKind(d.swapKind)) continue;
    recorded += 1;

    const raw = d.colleague ? normaliseColleague(d.colleague) : '';
    if (!raw) continue;
    named += 1;

    const key = sortKey(raw);
    const entry = byColleague.get(key) ?? { display: raw, counts: emptyCounts(), hours: 0 };
    entry.counts[d.swapKind] += 1;
    entry.hours += hoursDelta(d);
    byColleague.set(key, entry);
  }

  const balances = [...byColleague.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, e]) => ({
      colleague: e.display,
      counts: e.counts,
      favourBalance: e.counts['Ho coperto'] - e.counts['Mi ha coperto'],
      hoursBalance: e.hours,
    }));

  return { balances, recorded, named, unattributed: recorded - named };
}

/** Names already used, for autocomplete. Typing the same name twice is how
 *  a balance silently splits in two, so the app offers what exists. */
export function knownColleagues(days: readonly DayRecord[]): string[] {
  const seen = new Map<string, string>();
  for (const d of days) {
    const name = d.colleague ? normaliseColleague(d.colleague) : '';
    if (name && !seen.has(sortKey(name))) seen.set(sortKey(name), name);
  }
  return [...seen.values()].sort((a, b) =>
    sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0,
  );
}
