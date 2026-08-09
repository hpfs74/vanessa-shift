import { describe, expect, it } from 'vitest';

import { CONTRACT_KINDS, EMPTY_PROFILE, MAX_WEEKLY_HOURS, isContractKind } from '../src/index.js';

describe('EMPTY_PROFILE', () => {
  it('leaves every field unset', () => {
    // A profile that demands completeness before it can be saved never gets
    // saved: half of one is worth more than none.
    for (const [field, value] of Object.entries(EMPTY_PROFILE)) {
      expect(value, field).toBeNull();
    }
  });

  it('carries the ten fields the screen shows', () => {
    expect(Object.keys(EMPTY_PROFILE).sort()).toEqual(
      [
        'ccnlLevel',
        'contractKind',
        'employer',
        'firstName',
        'hiredOn',
        'jobTitle',
        'lastName',
        'ward',
        'weeklyHours',
        'workplace',
      ].sort(),
    );
  });
});

describe('isContractKind', () => {
  it('accepts the two kinds a contract can have', () => {
    for (const k of CONTRACT_KINDS) expect(isContractKind(k)).toBe(true);
  });

  it('refuses anything else', () => {
    // The guard is what keeps the stored value inside the declared union: a
    // type claiming two values while the table holds a third is a type that
    // has stopped telling the truth.
    expect(isContractKind('stagionale')).toBe(false);
    expect(isContractKind('')).toBe(false);
    expect(isContractKind(null)).toBe(false);
    expect(isContractKind(3)).toBe(false);
  });
});

describe('MAX_WEEKLY_HOURS', () => {
  it('is the hours a week actually contains', () => {
    expect(MAX_WEEKLY_HOURS).toBe(168);
  });
});
