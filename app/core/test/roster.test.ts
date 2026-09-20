import { describe, expect, it } from 'vitest';

import { normaliseCode, validateRoster } from '../src/index.js';

/** A well-formed `others` payload: one person, every day empty. */
function person(name: string, codes: string[], row: number | null = 3) {
  return { name, row, codes };
}

describe('normaliseCode', () => {
  it('uppercases and trims', () => {
    expect(normaliseCode(' m1 ')).toBe('M1');
  });

  it('keeps only letters and digits, so a code can never hold the separator', () => {
    expect(normaliseCode('M,')).toBe('M');
    expect(normaliseCode('P/1')).toBe('P1');
  });

  it('caps the length, so a model that wanders cannot store a sentence', () => {
    expect(normaliseCode('MATTINALUNGA')).toBe('MATT');
  });

  it('answers with an empty string for anything that is not one', () => {
    expect(normaliseCode(null)).toBe('');
    expect(normaliseCode(42)).toBe('');
  });
});

describe('validateRoster', () => {
  it('keeps a well-formed person', () => {
    const r = validateRoster(
      { others: [person('Giulia', Array(30).fill('M'))] },
      2026,
      9,
    );
    expect(r.people).toHaveLength(1);
    expect(r.people[0]!.name).toBe('Giulia');
    expect(r.people[0]!.codes).toHaveLength(30);
  });

  it('drops the malformed and keeps the rest: a bad row costs that row alone', () => {
    const r = validateRoster(
      {
        others: [
          person('Giulia', Array(30).fill('M')),
          person('Anna', Array(12).fill('P')), // wrong length for September
          person('', Array(30).fill('M')),
          'not an object',
          person('Marta', Array(30).fill('P1')),
        ],
      },
      2026,
      9,
    );
    expect(r.people.map((p) => p.name)).toEqual(['Giulia', 'Marta']);
  });

  it('never lets Vanessa in: her row already travels in the reading', () => {
    const r = validateRoster(
      { others: [person('  vanessa  ', Array(30).fill('M'))] },
      2026,
      9,
    );
    expect(r.people).toEqual([]);
  });

  it('keeps two people who normalise to the same name: on the sheet they are two rows', () => {
    const r = validateRoster(
      { others: [person('Giulia', Array(30).fill('M'), 3), person('Giulia', Array(30).fill('P'), 9)] },
      2026,
      9,
    );
    expect(r.people).toHaveLength(2);
    expect(r.people.map((p) => p.row)).toEqual([3, 9]);
  });

  it('survives a payload with no others at all', () => {
    expect(validateRoster({}, 2026, 9).people).toEqual([]);
    expect(validateRoster(null, 2026, 9).people).toEqual([]);
    expect(validateRoster({ others: 'nope' }, 2026, 9).people).toEqual([]);
  });

  it('carries the month it was told, not one of its own', () => {
    const r = validateRoster({ others: [] }, 2026, 9);
    expect(r).toMatchObject({ year: 2026, month: 9 });
  });
});
