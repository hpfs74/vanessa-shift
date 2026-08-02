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

/** Readable time range, with a dash for days off. */
export function timeRange(code: ShiftCode): string {
  const s = shift(code);
  return s.start ? `${s.start}-${s.end}` : '–';
}
