/** Shift codes: the single source of truth for hours and times.
 *
 * Codes and descriptions stay in Italian: they are what Vanessa reads.
 */

export type ShiftCode = 'L' | 'M' | 'M1' | 'P' | 'P1';

export interface Shift {
  readonly code: ShiftCode;
  readonly description: string;
  readonly start: string;
  readonly end: string;
  readonly hours: number;
}

export const SHIFTS: readonly Shift[] = [
  { code: 'L', description: 'Libero', start: '', end: '', hours: 0 },
  { code: 'M', description: 'Mattina', start: '07:00', end: '13:00', hours: 6 },
  { code: 'M1', description: 'Mattina lunga', start: '07:00', end: '14:00', hours: 7 },
  { code: 'P', description: 'Pomeriggio', start: '13:00', end: '20:00', hours: 7 },
  { code: 'P1', description: 'Pomeriggio lungo', start: '13:00', end: '21:00', hours: 8 },
];

const BY_CODE = new Map(SHIFTS.map((s) => [s.code, s]));

export function isShiftCode(v: unknown): v is ShiftCode {
  return typeof v === 'string' && BY_CODE.has(v as ShiftCode);
}

export function shift(code: ShiftCode): Shift {
  const s = BY_CODE.get(code);
  if (!s) throw new Error(`unknown shift code: ${code}`);
  return s;
}

/** Hours worked. A day with no code contributes nothing. */
export function hours(code: ShiftCode | undefined | null): number {
  return code ? shift(code).hours : 0;
}

/** A day as stored: the shift code, plus the hours actually worked when they
 *  differed from the shift's own. */
export interface DayEntry {
  readonly code: ShiftCode;
  readonly hoursOverride?: number | null;
}

/** Hours worked, honouring an override.
 *
 * Zero is a legitimate override — went in, sent home — so the check is for
 * null, not for falsiness: `?? ` would silently discard a real 0. */
export function entryHours(e: DayEntry | undefined | null): number {
  if (!e) return 0;
  return e.hoursOverride == null ? hours(e.code) : e.hoursOverride;
}

export function hasOverride(e: DayEntry | undefined | null): boolean {
  return Boolean(e) && e!.hoursOverride != null && e!.hoursOverride !== hours(e!.code);
}

/** Half hours are the smallest unit worth typing; a day cannot exceed 24. */
export const MAX_DAY_HOURS = 24;

export function isValidHours(v: unknown): v is number {
  return (
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_DAY_HOURS
  );
}

/** Readable time range, with a dash for days off. */
export function timeRange(code: ShiftCode): string {
  const s = shift(code);
  return s.start ? `${s.start}-${s.end}` : '–';
}
