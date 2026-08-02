import { describe, expect, it } from 'vitest';

import {
  InvalidReading,
  RowNotFound,
  romeToday,
  validateReading,
  entriesFromReading,
} from '../src/index.js';

/** A well-formed reading of `days` days, all without a shift. */
function emptyReading(month: number, year: number, days: number) {
  return {
    month,
    year,
    found: true,
    foundName: 'Vanessa',
    foundRow: 14,
    days: Array.from({ length: days }, (_, i) => ({
      day: i + 1,
      code: null,
      confident: true,
    })),
  };
}

/** July as it stands on the photo: x until the 16th, then fifteen shifts. */
const JULY_CODES = ['M','M','P','L','P','M','M','M','L','P','M','M','M','L','P'] as const;

function julyReading() {
  const e = emptyReading(7, 2026, 31);
  JULY_CODES.forEach((code, i) => {
    e.days[16 + i] = { day: 17 + i, code, confident: true } as never;
  });
  return e;
}

describe('validateReading', () => {
  it('accepts a well-formed whole month', () => {
    const e = validateReading(emptyReading(8, 2026, 31), 2026);
    expect(e.month).toBe(8);
    expect(e.days).toHaveLength(31);
  });

  it('accepts the year before and after, not a far one', () => {
    expect(() => validateReading(emptyReading(8, 2025, 31), 2026)).not.toThrow();
    expect(() => validateReading(emptyReading(8, 2027, 31), 2026)).not.toThrow();
    expect(() => validateReading(emptyReading(8, 2019, 31), 2026)).toThrow(InvalidReading);
  });

  it('rejects the year just past the accepted range', () => {
    expect(() => validateReading(emptyReading(8, 2024, 31), 2026)).toThrow(InvalidReading);
    expect(() => validateReading(emptyReading(8, 2028, 31), 2026)).toThrow(InvalidReading);
  });

  it('rejects a month out of range', () => {
    expect(() => validateReading({ ...emptyReading(1, 2026, 31), month: 13 }, 2026)).toThrow(
      InvalidReading,
    );
  });

  it('wants exactly the days of the month: February 2026 has 28', () => {
    expect(() => validateReading(emptyReading(2, 2026, 28), 2026)).not.toThrow();
    expect(() => validateReading(emptyReading(2, 2026, 29), 2026)).toThrow(InvalidReading);
  });

  it('rejects a missing day', () => {
    const e = emptyReading(8, 2026, 31);
    e.days.splice(10, 1);
    expect(() => validateReading(e, 2026)).toThrow(InvalidReading);
  });

  it('rejects a duplicate day', () => {
    const e = emptyReading(8, 2026, 31);
    e.days[11] = { day: 11, code: null, confident: true };
    expect(() => validateReading(e, 2026)).toThrow(InvalidReading);
  });

  it('rejects a day outside the month', () => {
    const e = emptyReading(8, 2026, 31);
    e.days[30] = { day: 32, code: null, confident: true };
    expect(() => validateReading(e, 2026)).toThrow(InvalidReading);
  });

  it('rejects a code that does not exist', () => {
    const e = emptyReading(8, 2026, 31);
    e.days[0] = { day: 1, code: 'P2' as never, confident: true };
    expect(() => validateReading(e, 2026)).toThrow(InvalidReading);
  });

  it('rejects a non-boolean confident', () => {
    const e = emptyReading(8, 2026, 31);
    e.days[0] = { day: 1, code: null, confident: 'yes' as never };
    expect(() => validateReading(e, 2026)).toThrow(InvalidReading);
  });

  it('rejects something that is not even an object', () => {
    expect(() => validateReading('ciao', 2026)).toThrow(InvalidReading);
    expect(() => validateReading(null, 2026)).toThrow(InvalidReading);
    expect(() => validateReading([], 2026)).toThrow(InvalidReading);
  });

  it('when the row is not there it says so with its own error', () => {
    const e = { ...emptyReading(8, 2026, 31), found: false, foundName: null, foundRow: null };
    expect(() => validateReading(e, 2026)).toThrow(RowNotFound);
  });
});

describe('entriesFromReading', () => {
  it('skips days without a code: July starts on the 17th', () => {
    const entries = entriesFromReading(validateReading(julyReading(), 2026));
    expect(entries).toHaveLength(15);
    expect(entries[0]).toEqual({ date: '2026-07-17', day: 17, code: 'M' });
    expect(entries[14]).toEqual({ date: '2026-07-31', day: 31, code: 'P' });
  });

  it('a month with nothing produces no entries', () => {
    expect(entriesFromReading(validateReading(emptyReading(8, 2026, 31), 2026))).toEqual([]);
  });
});

describe('romeToday', () => {
  it('is the Italian civil date, not the UTC one', () => {
    // Half past midnight in Rome in summer: in Greenwich it's still the day before.
    expect(romeToday(new Date('2026-08-02T22:30:00Z'))).toBe('2026-08-03');
    expect(romeToday(new Date('2026-08-02T12:00:00Z'))).toBe('2026-08-02');
  });
});
