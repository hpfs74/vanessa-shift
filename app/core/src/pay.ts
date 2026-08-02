/** Hour bucketing and pay simulation.
 *
 * Every worked hour falls into exactly one bucket, with precedence
 * holiday > Sunday > Saturday. Ordinary hours are NOT a remainder: they are
 * computed by membership like the others, so a double count cannot hide by
 * silently eroding them.
 */

import { type DayEntry, entryHours } from './shifts.js';
import { type IsoDate, monthDays } from './dates.js';
import { dayKind, italianHolidays } from './holidays.js';

export interface MonthHours {
  readonly ordinary: number;
  readonly saturday: number;
  readonly sunday: number;
  readonly holiday: number;
  readonly total: number;
}

export interface PaySettings {
  readonly hourlyRate: number | null;
  readonly saturdayPremium: number | null;
  readonly sundayPremium: number | null;
  readonly holidayPremium: number | null;
  readonly thirteenthAccrual: number | null;
  readonly netRatio: number | null;
}

export const EMPTY_PAY_SETTINGS: PaySettings = {
  hourlyRate: null,
  saturdayPremium: null,
  sundayPremium: null,
  holidayPremium: null,
  thirteenthAccrual: 1 / 12,
  netRatio: null,
};

/** Buckets a month's hours. `days` maps ISO date -> the day as stored.
 *  Hours come from `entryHours`, so a per-day override is honoured here and
 *  therefore in the pay simulation too. */
export function monthHours(
  year: number,
  month: number,
  days: ReadonlyMap<IsoDate, DayEntry | null | undefined>,
): MonthHours {
  const holidays = italianHolidays(year);
  let ordinary = 0;
  let saturday = 0;
  let sunday = 0;
  let holiday = 0;

  for (const d of monthDays(year, month)) {
    const h = entryHours(days.get(d));
    if (h === 0) continue;
    switch (dayKind(d, holidays)) {
      case 'holiday':
        holiday += h;
        break;
      case 'sunday':
        sunday += h;
        break;
      case 'saturday':
        saturday += h;
        break;
      default:
        ordinary += h;
    }
  }

  return { ordinary, saturday, sunday, holiday, total: ordinary + saturday + sunday + holiday };
}

export interface MonthPay {
  readonly basePay: number | null;
  readonly saturdayPremium: number | null;
  readonly sundayPremium: number | null;
  readonly holidayPremium: number | null;
  readonly thirteenthAccrual: number | null;
  readonly grossTotal: number | null;
  readonly estimatedNet: number | null;
}

const NOTHING: MonthPay = {
  basePay: null,
  saturdayPremium: null,
  sundayPremium: null,
  holidayPremium: null,
  thirteenthAccrual: null,
  grossTotal: null,
  estimatedNet: null,
};

/** No figure appears until it is true. */
export function monthPay(h: MonthHours, p: PaySettings): MonthPay {
  if (p.hourlyRate == null) return NOTHING;

  const basePay = h.total * p.hourlyRate;
  const sat = p.saturdayPremium == null ? null : h.saturday * p.hourlyRate * p.saturdayPremium;
  const sun = p.sundayPremium == null ? null : h.sunday * p.hourlyRate * p.sundayPremium;
  const hol = p.holidayPremium == null ? null : h.holiday * p.hourlyRate * p.holidayPremium;

  // Emptiness propagates: a total that ignores a premium is not an incomplete
  // number, it is a wrong one, understated and presented as a total.
  // Understating what someone is owed is the worse failure of the two.
  const taxable = sat == null || sun == null || hol == null ? null : basePay + sat + sun + hol;
  const accrual =
    taxable == null || p.thirteenthAccrual == null ? null : taxable * p.thirteenthAccrual;
  const grossTotal = taxable == null || accrual == null ? null : taxable + accrual;
  const estimatedNet = grossTotal == null || p.netRatio == null ? null : grossTotal * p.netRatio;

  return {
    basePay,
    saturdayPremium: sat,
    sundayPremium: sun,
    holidayPremium: hol,
    thirteenthAccrual: accrual,
    grossTotal,
    estimatedNet,
  };
}

/** Sums over several months. Stays `null` when every addend is `null`. */
export function sumPay(months: readonly MonthPay[]): MonthPay {
  const keys = Object.keys(NOTHING) as (keyof MonthPay)[];
  const out = {} as Record<keyof MonthPay, number | null>;
  for (const k of keys) {
    const values = months.map((m) => m[k]).filter((v): v is number => v != null);
    out[k] = values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
  }
  return out as MonthPay;
}
