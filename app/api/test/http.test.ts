import { describe, expect, it } from 'vitest';

import { EMPTY_PROFILE } from '@vanessa/core';

import {
  InvalidInput,
  MAX_ROSTER_PEOPLE,
  requireObject,
  requireProfile,
  requireRosterPeople,
  requireWeeklyHours,
  requireYearMonth,
} from '../src/http.js';

describe('requireWeeklyHours', () => {
  it('reads a number', () => {
    expect(requireWeeklyHours(24)).toBe(24);
  });

  it('keeps zero apart from unset', () => {
    // Same distinction `hoursOverride` already makes on a shift: zero is an
    // answer, absent is the lack of one.
    expect(requireWeeklyHours(0)).toBe(0);
    expect(requireWeeklyHours('')).toBeNull();
    expect(requireWeeklyHours(null)).toBeNull();
    expect(requireWeeklyHours(undefined)).toBeNull();
  });

  it('refuses what a week cannot hold', () => {
    expect(() => requireWeeklyHours(-1)).toThrow(InvalidInput);
    expect(() => requireWeeklyHours(169)).toThrow(InvalidInput);
    expect(() => requireWeeklyHours(Number.POSITIVE_INFINITY)).toThrow(InvalidInput);
    expect(() => requireWeeklyHours('ventiquattro')).toThrow(InvalidInput);
  });
});

describe('requireObject', () => {
  it('passes an object through', () => {
    expect(requireObject({ a: 1 }, 'pay')).toEqual({ a: 1 });
  });

  it('refuses what is not one', () => {
    expect(() => requireObject(null, 'pay')).toThrow(InvalidInput);
    expect(() => requireObject([1, 2], 'pay')).toThrow(InvalidInput);
    expect(() => requireObject('pay', 'pay')).toThrow(InvalidInput);
  });
});

describe('requireProfile', () => {
  it('accepts an empty body as an empty profile', () => {
    // Every field is optional on purpose: she fills this in over time, from
    // a contract in a drawer.
    expect(requireProfile({})).toEqual(EMPTY_PROFILE);
  });

  it('reads a full profile', () => {
    expect(
      requireProfile({
        firstName: 'Vanessa',
        lastName: 'Rossi',
        employer: 'Cooperativa Esempio',
        hiredOn: '2021-03-12',
        contractKind: 'indeterminato',
        ccnlLevel: 'C1',
        jobTitle: 'OSS',
        weeklyHours: 24,
        workplace: 'Casa di riposo',
        ward: 'Nucleo 2',
      }),
    ).toEqual({
      firstName: 'Vanessa',
      lastName: 'Rossi',
      employer: 'Cooperativa Esempio',
      hiredOn: '2021-03-12',
      contractKind: 'indeterminato',
      ccnlLevel: 'C1',
      jobTitle: 'OSS',
      weeklyHours: 24,
      workplace: 'Casa di riposo',
      ward: 'Nucleo 2',
    });
  });

  it('refuses a contract kind nobody declared', () => {
    expect(() => requireProfile({ contractKind: 'stagionale' })).toThrow(InvalidInput);
  });

  it('treats an empty contract kind as unset', () => {
    expect(requireProfile({ contractKind: '' }).contractKind).toBeNull();
  });

  it('refuses a hiring date that is not one', () => {
    expect(() => requireProfile({ hiredOn: '12/03/2021' })).toThrow(InvalidInput);
  });

  it('refuses text past its limit', () => {
    expect(() => requireProfile({ firstName: 'x'.repeat(101) })).toThrow(InvalidInput);
  });
});

describe('requireYearMonth', () => {
  it('reads the two path parameters', () => {
    expect(requireYearMonth({ year: '2026', month: '09' })).toEqual({ year: 2026, month: 9 });
  });

  it('refuses a month outside the year', () => {
    expect(() => requireYearMonth({ year: '2026', month: '13' })).toThrow(InvalidInput);
    expect(() => requireYearMonth({ year: '2026', month: '0' })).toThrow(InvalidInput);
  });

  it('refuses what is not a year, including nothing at all', () => {
    expect(() => requireYearMonth({ year: 'ciao', month: '9' })).toThrow(InvalidInput);
    expect(() => requireYearMonth(undefined)).toThrow(InvalidInput);
  });
});

describe('requireRosterPeople', () => {
  const people = [{ name: 'Giulia', row: 3, codes: Array(30).fill('M') }];

  it('accepts a well-formed body', () => {
    expect(requireRosterPeople({ people }, 30)).toEqual(people);
  });

  it('normalises the codes on the way in', () => {
    const r = requireRosterPeople({ people: [{ name: 'Giulia', row: null, codes: [' m1 ', ...Array(29).fill('')] }] }, 30);
    expect(r[0]!.codes[0]).toBe('M1');
  });

  // Strict here, unlike validateRoster: this body comes from our own client,
  // which has already validated it. A malformed one is a bug, not a bad photo.
  it('refuses a row that is not the length of the month', () => {
    expect(() => requireRosterPeople({ people: [{ name: 'Giulia', row: 3, codes: ['M'] }] }, 30)).toThrow(
      InvalidInput,
    );
  });

  it('refuses a nameless person and a missing list', () => {
    expect(() => requireRosterPeople({ people: [{ name: '  ', row: 3, codes: Array(30).fill('') }] }, 30)).toThrow(InvalidInput);
    expect(() => requireRosterPeople({}, 30)).toThrow(InvalidInput);
  });

  it('caps how many people one month can hold', () => {
    const many = Array.from({ length: MAX_ROSTER_PEOPLE + 1 }, (_, i) => ({
      name: `P${i}`,
      row: null,
      codes: Array(30).fill(''),
    }));
    expect(() => requireRosterPeople({ people: many }, 30)).toThrow(InvalidInput);
  });
});
