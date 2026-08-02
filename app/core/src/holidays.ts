/** Italian national holidays. The local patron saint is not included.
 *
 * Holiday names stay in Italian: they are shown to Vanessa.
 */

import { type IsoDate, addDays, toIso } from './dates.js';

/** Easter Sunday, anonymous Gregorian algorithm. */
export function easter(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIso(year, month, day);
}

export function italianHolidays(year: number): Map<IsoDate, string> {
  const holidays = new Map<IsoDate, string>([
    [toIso(year, 1, 1), 'Capodanno'],
    [toIso(year, 1, 6), 'Epifania'],
    [toIso(year, 4, 25), 'Liberazione'],
    [toIso(year, 5, 1), 'Festa del Lavoro'],
    [toIso(year, 6, 2), 'Festa della Repubblica'],
    [toIso(year, 8, 15), 'Ferragosto'],
    [toIso(year, 11, 1), 'Ognissanti'],
    [toIso(year, 12, 8), 'Immacolata'],
    [toIso(year, 12, 25), 'Natale'],
    [toIso(year, 12, 26), 'Santo Stefano'],
  ]);
  // When Easter Monday falls on 25 April it is one day, not two:
  // the fixed holiday keeps its name.
  const easterMonday = addDays(easter(year), 1);
  if (!holidays.has(easterMonday)) holidays.set(easterMonday, "Lunedi dell'Angelo");
  return holidays;
}

export type DayKind = 'weekday' | 'saturday' | 'sunday' | 'holiday';

/** Precedence: holiday beats Sunday, Sunday beats Saturday. */
export function dayKind(d: IsoDate, holidays: Map<IsoDate, string>): DayKind {
  if (holidays.has(d)) return 'holiday';
  const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  if (dow === 6) return 'sunday';
  if (dow === 5) return 'saturday';
  return 'weekday';
}
