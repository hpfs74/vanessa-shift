import { describe, expect, it } from 'vitest';

import {
  type IsoDate,
  type MonthHours,
  type ShiftCode,
  EMPTY_PAY_SETTINGS,
  SHIFTS,
  dayKind,
  daysBetween,
  easter,
  hours,
  isIsoDate,
  isShiftCode,
  italianHolidays,
  monthDays,
  monthHours,
  monthPay,
  sumPay,
  timeRange,
  today,
  weekday,
  yearDays,
} from '../src/index.js';

describe('shift codes', () => {
  it('afternoon is seven hours and long afternoon is eight', () => {
    expect(hours('P')).toBe(7);
    expect(hours('P1')).toBe(8);
    expect(timeRange('P')).toBe('13:00-20:00');
    expect(timeRange('P1')).toBe('13:00-21:00');
  });

  it('morning, long morning and day off', () => {
    expect(hours('M')).toBe(6);
    expect(hours('M1')).toBe(7);
    expect(hours('L')).toBe(0);
    expect(timeRange('L')).toBe('–');
  });

  it('a day with no code contributes no hours', () => {
    expect(hours(undefined)).toBe(0);
    expect(hours(null)).toBe(0);
  });

  it('recognises only the known codes', () => {
    for (const s of SHIFTS) expect(isShiftCode(s.code)).toBe(true);
    for (const v of ['X', 'm', '', 'P2', 7, null, undefined]) {
      expect(isShiftCode(v)).toBe(false);
    }
  });
});

describe('dates', () => {
  it('accepts only ISO dates that really exist', () => {
    expect(isIsoDate('2026-01-15')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-11-31')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-00-10')).toBe(false);
    expect(isIsoDate('15/01/2026')).toBe(false);
    expect(isIsoDate('2026-1-5')).toBe(false);
    expect(isIsoDate(20260115)).toBe(false);
  });

  it('1 January 2026 is a Thursday, and the week starts on Monday', () => {
    expect(weekday('2026-01-01')).toBe(3);
    expect(weekday('2026-01-05')).toBe(0);
    expect(weekday('2026-04-25')).toBe(5);
    expect(weekday('2026-11-01')).toBe(6);
  });

  it('counts the days of every month, leap years included', () => {
    expect(monthDays(2026, 2)).toHaveLength(28);
    expect(monthDays(2024, 2)).toHaveLength(29);
    expect(yearDays(2026)).toHaveLength(365);
    expect(yearDays(2024)).toHaveLength(366);
  });

  it('reads today as a civil local date, not a UTC one', () => {
    // 22:30 on 2 August in Rome is 20:30 UTC: same day either way.
    expect(today(new Date(2026, 7, 2, 22, 30))).toBe('2026-08-02');
    // 00:30 on 3 August in Rome is 22:30 UTC on the 2nd. Deriving the date
    // from toISOString() here would show yesterday.
    expect(today(new Date(2026, 7, 3, 0, 30))).toBe('2026-08-03');
    // Single-digit month and day still come out padded.
    expect(today(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });

  it('does not drift by a day across a daylight-saving change', () => {
    // Italian summer time starts on the last Sunday of March.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('holidays', () => {
  it('computes Easter', () => {
    expect(easter(2026)).toBe('2026-04-05');
    expect(easter(2024)).toBe('2024-03-31');
    expect(easter(2011)).toBe('2011-04-24');
    expect(easter(2027)).toBe('2027-03-28');
    expect(easter(2038)).toBe('2038-04-25');
    expect(easter(2000)).toBe('2000-04-23');
  });

  it('2026 has eleven national holidays', () => {
    const h = italianHolidays(2026);
    expect(h.size).toBe(11);
    expect(h.get('2026-04-06')).toBe("Lunedi dell'Angelo");
    expect(h.get('2026-12-26')).toBe('Santo Stefano');
  });

  it('when Easter Monday falls on 25 April it is not counted twice', () => {
    const h = italianHolidays(2011);
    expect(h.size).toBe(10);
    expect(h.get('2011-04-25')).toBe('Liberazione');
  });

  it('holiday beats Sunday, Sunday beats Saturday', () => {
    const h = italianHolidays(2026);
    expect(dayKind('2026-04-25', h)).toBe('holiday'); // a Saturday holiday
    expect(dayKind('2026-11-01', h)).toBe('holiday'); // a Sunday holiday
    expect(dayKind('2026-04-26', h)).toBe('sunday');
    expect(dayKind('2026-04-18', h)).toBe('saturday');
    expect(dayKind('2026-04-24', h)).toBe('weekday');
  });
});

/** Assigns a code to every day of the year, cycling through the worked ones. */
function fullYear(year: number): Map<IsoDate, ShiftCode> {
  const worked: ShiftCode[] = ['M', 'M1', 'P', 'P1'];
  const shifts = new Map<IsoDate, ShiftCode>();
  yearDays(year).forEach((d, i) => shifts.set(d, worked[i % worked.length]));
  return shifts;
}

describe('hour bucketing', () => {
  it('every hour lands in exactly one bucket, all twelve months', () => {
    const shifts = fullYear(2026);
    const holidays = italianHolidays(2026);

    for (let month = 1; month <= 12; month++) {
      const h = monthHours(2026, month, shifts);
      expect(h.ordinary + h.saturday + h.sunday + h.holiday).toBe(h.total);

      // Checked against an independent oracle, day by day.
      const expected = { weekday: 0, saturday: 0, sunday: 0, holiday: 0 };
      for (const d of monthDays(2026, month)) {
        expected[dayKind(d, holidays)] += hours(shifts.get(d));
      }
      expect(h.ordinary).toBe(expected.weekday);
      expect(h.saturday).toBe(expected.saturday);
      expect(h.sunday).toBe(expected.sunday);
      expect(h.holiday).toBe(expected.holiday);
    }
  });

  it('the twelve months together cover every hour of the year', () => {
    const shifts = fullYear(2026);
    let sum = 0;
    for (let month = 1; month <= 12; month++) sum += monthHours(2026, month, shifts).total;
    const all = yearDays(2026).reduce((acc, d) => acc + hours(shifts.get(d)), 0);
    expect(sum).toBe(all);
  });

  it('a Saturday holiday counts as a holiday, not as a Saturday', () => {
    // 25 April 2026 is a Saturday and a holiday.
    const shifts = new Map<IsoDate, ShiftCode>([['2026-04-25', 'P1']]);
    const h = monthHours(2026, 4, shifts);
    expect(h.holiday).toBe(8);
    expect(h.saturday).toBe(0);
    expect(h.total).toBe(8);
  });

  it('a Sunday holiday counts as a holiday, not as a Sunday', () => {
    // 1 November 2026 is a Sunday and a holiday.
    const shifts = new Map<IsoDate, ShiftCode>([['2026-11-01', 'M']]);
    const h = monthHours(2026, 11, shifts);
    expect(h.holiday).toBe(6);
    expect(h.sunday).toBe(0);
  });

  it('days off and days never entered do not count', () => {
    const shifts = new Map<IsoDate, ShiftCode>([['2026-01-05', 'L']]);
    expect(monthHours(2026, 1, shifts).total).toBe(0);
    expect(monthHours(2026, 1, new Map()).total).toBe(0);
  });

  it('works on a leap year too', () => {
    const shifts = fullYear(2024);
    const h = monthHours(2024, 2, shifts);
    expect(h.ordinary + h.saturday + h.sunday + h.holiday).toBe(h.total);
    expect(monthDays(2024, 2)).toHaveLength(29);
  });
});

describe('pay', () => {
  const HOURS: MonthHours = {
    ordinary: 100,
    saturday: 8,
    sunday: 4,
    holiday: 2,
    total: 114,
  };

  it('without an hourly rate no figure appears', () => {
    const p = monthPay(HOURS, EMPTY_PAY_SETTINGS);
    expect(p.basePay).toBeNull();
    expect(p.grossTotal).toBeNull();
    expect(p.estimatedNet).toBeNull();
    expect(p.thirteenthAccrual).toBeNull();
  });

  it('computes base, premiums, accrual and net', () => {
    const p = monthPay(HOURS, {
      hourlyRate: 10,
      saturdayPremium: 0.2,
      sundayPremium: 0.3,
      holidayPremium: 0.5,
      thirteenthAccrual: 1 / 12,
      netRatio: 0.75,
    });
    expect(p.basePay).toBe(1140);
    expect(p.saturdayPremium).toBeCloseTo(16, 10);
    expect(p.sundayPremium).toBeCloseTo(12, 10);
    expect(p.holidayPremium).toBeCloseTo(10, 10);
    const taxable = 1140 + 16 + 12 + 10;
    expect(p.thirteenthAccrual).toBeCloseTo(taxable / 12, 10);
    expect(p.grossTotal).toBeCloseTo(taxable + taxable / 12, 10);
    expect(p.estimatedNet).toBeCloseTo((taxable + taxable / 12) * 0.75, 10);
  });

  it('with only the rate it shows base pay but no total', () => {
    // A total that ignores premiums understates what is owed:
    // better nothing than a figure that is wrong downwards.
    const p = monthPay(HOURS, { ...EMPTY_PAY_SETTINGS, hourlyRate: 10 });
    expect(p.basePay).toBe(1140);
    expect(p.saturdayPremium).toBeNull();
    expect(p.sundayPremium).toBeNull();
    expect(p.holidayPremium).toBeNull();
    expect(p.grossTotal).toBeNull();
    expect(p.thirteenthAccrual).toBeNull();
    expect(p.estimatedNet).toBeNull();
  });

  it('one missing premium is enough to withhold the total', () => {
    const almost = {
      ...EMPTY_PAY_SETTINGS,
      hourlyRate: 10,
      saturdayPremium: 0.2,
      sundayPremium: 0.3,
      netRatio: 0.7,
    };
    const p = monthPay(HOURS, almost);
    expect(p.saturdayPremium).toBeCloseTo(16, 10);
    expect(p.holidayPremium).toBeNull();
    expect(p.grossTotal).toBeNull();
    expect(p.estimatedNet).toBeNull();
  });

  it('the net also needs the ratio', () => {
    const complete = {
      hourlyRate: 10,
      saturdayPremium: 0.2,
      sundayPremium: 0.3,
      holidayPremium: 0.5,
      thirteenthAccrual: 1 / 12,
      netRatio: null,
    };
    expect(monthPay(HOURS, complete).grossTotal).not.toBeNull();
    expect(monthPay(HOURS, complete).estimatedNet).toBeNull();
    const withRatio = monthPay(HOURS, { ...complete, netRatio: 0.7 });
    const taxable = 1140 + 16 + 12 + 10;
    expect(withRatio.estimatedNet).toBeCloseTo((taxable + taxable / 12) * 0.7, 10);
  });

  it('the yearly total stays empty when every month is empty', () => {
    const empty = Array.from({ length: 12 }, () => monthPay(HOURS, EMPTY_PAY_SETTINGS));
    const t = sumPay(empty);
    expect(t.grossTotal).toBeNull();
    expect(t.estimatedNet).toBeNull();
  });

  it('the yearly total sums the configured months', () => {
    const settings = { ...EMPTY_PAY_SETTINGS, hourlyRate: 10, netRatio: 0.5 };
    const months = Array.from({ length: 12 }, () => monthPay(HOURS, settings));
    const t = sumPay(months);
    expect(t.basePay).toBeCloseTo(1140 * 12, 8);
  });
});
