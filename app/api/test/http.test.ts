import { describe, expect, it } from 'vitest';

import { EMPTY_PROFILE } from '@vanessa/core';

import { InvalidInput, requireObject, requireProfile, requireWeeklyHours } from '../src/http.js';

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
