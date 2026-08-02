/** Dates as ISO `YYYY-MM-DD` strings, always civil local time.
 *
 * Time zones never come into play: a shift on 15 March is 15 March wherever
 * you look at it. Using `Date` with times here would be an elaborate way to
 * let a daylight-saving change shift a day.
 *
 * Month and weekday names stay in Italian: they are displayed to Vanessa.
 */

export type IsoDate = string;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isIsoDate(v: unknown): v is IsoDate {
  if (typeof v !== 'string') return false;
  const m = ISO.exec(v);
  if (!m) return false;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12) return false;
  // Rejects 31 November and 29 February in non-leap years.
  return day >= 1 && day <= daysInMonth(year, month);
}

export function parseIso(d: IsoDate): { year: number; month: number; day: number } {
  const m = ISO.exec(d);
  if (!m) throw new Error(`invalid date: ${d}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function toIso(year: number, month: number, day: number): IsoDate {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** 0 = Monday ... 6 = Sunday. The working week starts on Monday. */
export function weekday(d: IsoDate): number {
  const { year, month, day } = parseIso(d);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (dow + 6) % 7;
}

export function isSaturday(d: IsoDate): boolean {
  return weekday(d) === 5;
}

export function isSunday(d: IsoDate): boolean {
  return weekday(d) === 6;
}

export function monthDays(year: number, month: number): IsoDate[] {
  const n = daysInMonth(year, month);
  return Array.from({ length: n }, (_, i) => toIso(year, month, i + 1));
}

export function yearDays(year: number): IsoDate[] {
  const out: IsoDate[] = [];
  for (let m = 1; m <= 12; m++) out.push(...monthDays(year, m));
  return out;
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const { year, month, day } = parseIso(d);
  const t = new Date(Date.UTC(year, month - 1, day + n));
  return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  const pa = parseIso(a);
  const pb = parseIso(b);
  const ta = Date.UTC(pa.year, pa.month - 1, pa.day);
  const tb = Date.UTC(pb.year, pb.month - 1, pb.day);
  return Math.round((tb - ta) / 86_400_000);
}

/** Today as a civil local date.
 *
 * Deliberately not derived from toISOString(), which is UTC: in Italy that
 * turns every evening after 01:00 CEST into tomorrow, so the calendar would
 * highlight the wrong day for a couple of hours each night.
 */
export function today(now: Date = new Date()): IsoDate {
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Displayed to the user, hence Italian. */
export const MONTH_NAMES = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
] as const;

export const SHORT_DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'] as const;
