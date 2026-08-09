/** Vanessa's own data: who she is for the app, and what her contract says.
 *
 *  Nothing in here is computed on. It is stored, and it is shown.
 */

import type { IsoDate } from './dates.js';

export const CONTRACT_KINDS = ['indeterminato', 'determinato'] as const;

export type ContractKind = (typeof CONTRACT_KINDS)[number];

export function isContractKind(v: unknown): v is ContractKind {
  return typeof v === 'string' && (CONTRACT_KINDS as readonly string[]).includes(v);
}

/** A week holds 168 hours. Past that the number is a typo, not a contract. */
export const MAX_WEEKLY_HOURS = 168;

export interface Profile {
  readonly firstName: string | null;
  readonly lastName: string | null;
  /** The cooperative she works for. */
  readonly employer: string | null;
  readonly hiredOn: IsoDate | null;
  readonly contractKind: ContractKind | null;
  /** CCNL level: C1, D2... It is what justifies the hourly rate typed into
   *  the pay settings, which is why the two are shown side by side. */
  readonly ccnlLevel: string | null;
  readonly jobTitle: string | null;
  /** Contracted hours per week.
   *
   *  DISPLAYED ONLY. Nothing reads this — not the hour totals, not the
   *  summary, not the pay simulation. Sitting next to hours actually worked
   *  it looks like a comparison that already exists, and it is not one.
   *
   *  Wiring it up is a spec of its own: it has to decide what happens to
   *  months started halfway, to holidays, to sick days and to leave — and of
   *  the last the data model knows nothing at all. */
  readonly weeklyHours: number | null;
  readonly workplace: string | null;
  readonly ward: string | null;
}

export const EMPTY_PROFILE: Profile = {
  firstName: null,
  lastName: null,
  employer: null,
  hiredOn: null,
  contractKind: null,
  ccnlLevel: null,
  jobTitle: null,
  weeklyHours: null,
  workplace: null,
  ward: null,
};
