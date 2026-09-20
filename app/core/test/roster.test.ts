import { describe, expect, it } from 'vitest';

import { countOverlapping, normaliseCode, overlaps, reshapeRoster, rosterOnDay, validateRoster } from '../src/index.js';

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

describe('overlaps', () => {
  it('is false when the shifts only hand over: M ends when P begins', () => {
    expect(overlaps('M', 'P')).toBe(false);
  });

  it('is true when the hours really cross: M1 runs to 14, P starts at 13', () => {
    expect(overlaps('M1', 'P')).toBe(true);
  });

  it('is true for two shifts of the same kind', () => {
    expect(overlaps('P', 'P1')).toBe(true);
    expect(overlaps('M', 'M')).toBe(true);
  });

  it('is false for Libero, which has no hours to share', () => {
    expect(overlaps('L', 'M')).toBe(false);
    expect(overlaps('M', 'L')).toBe(false);
  });

  // The important one. An unknown code has no times, and guessing would be
  // worse than silence: saying "you are with Anna" when Anna is on nights is
  // a false statement, while saying nothing is only a missing one.
  it('is false whenever either side is a code the app does not know', () => {
    expect(overlaps('F', 'M')).toBe(false);
    expect(overlaps('M', 'N1')).toBe(false);
    expect(overlaps('F', 'F')).toBe(false);
    expect(overlaps('', 'M')).toBe(false);
  });
});

describe('rosterOnDay', () => {
  const roster = {
    year: 2026,
    month: 9,
    people: [
      { name: 'Giulia', row: 3, codes: ['P', ...Array(29).fill('')] },
      { name: 'Marta', row: 4, codes: ['M', ...Array(29).fill('')] },
      { name: 'Anna', row: 5, codes: ['F', ...Array(29).fill('')] },
      { name: 'Luca', row: 6, codes: ['L', ...Array(29).fill('')] },
      { name: 'Sara', row: 7, codes: ['', ...Array(29).fill('')] },
    ],
  };

  it('splits the day between who shares your hours and who is merely there', () => {
    const day = rosterOnDay(roster, '2026-09-01', 'P');
    expect(day.map((e) => [e.name, e.withYou])).toEqual([
      ['Giulia', true],
      ['Marta', false],
      ['Anna', false],
    ]);
  });

  it('leaves out the empty cells and the days off: neither is somebody at work', () => {
    const names = rosterOnDay(roster, '2026-09-01', 'P').map((e) => e.name);
    expect(names).not.toContain('Luca'); // L
    expect(names).not.toContain('Sara'); // empty cell
  });

  it('is empty for a date outside the month it holds', () => {
    expect(rosterOnDay(roster, '2026-10-01', 'P')).toEqual([]);
    expect(rosterOnDay(roster, '2025-09-01', 'P')).toEqual([]);
  });

  it('is empty when there is no roster at all', () => {
    expect(rosterOnDay(null, '2026-09-01', 'P')).toEqual([]);
  });

  it('still lists the day when she is off: who is in is a fact about the ward', () => {
    const day = rosterOnDay(roster, '2026-09-01', '');
    expect(day).toHaveLength(3);
    expect(day.every((e) => !e.withYou)).toBe(true);
  });
});

describe('countOverlapping', () => {
  const roster = {
    year: 2026,
    month: 9,
    people: [
      { name: 'Giulia', row: 3, codes: ['P', ...Array(29).fill('')] },
      { name: 'Marta', row: 4, codes: ['P1', ...Array(29).fill('')] },
      { name: 'Anna', row: 5, codes: ['M', ...Array(29).fill('')] },
    ],
  };

  it('counts only the ones who share the hours', () => {
    expect(countOverlapping(roster, '2026-09-01', 'P')).toBe(2);
  });

  it('is zero on a day she is not working', () => {
    expect(countOverlapping(roster, '2026-09-01', '')).toBe(0);
  });

  it('is zero on a day nobody is in', () => {
    expect(countOverlapping(roster, '2026-09-02', 'P')).toBe(0);
  });
});

describe('reshapeRoster', () => {
  const september = {
    year: 2026,
    month: 9,
    people: [{ name: 'Giulia', row: 3, codes: Array.from({ length: 30 }, (_, i) => `D${i}`) }],
  };

  it('grows into a longer month, the new days empty', () => {
    const r = reshapeRoster(september, 2026, 10); // 31 days
    expect(r.people[0]!.codes).toHaveLength(31);
    expect(r.people[0]!.codes[30]).toBe('');
    expect(r.people[0]!.codes[0]).toBe('D0');
  });

  it('shrinks into a shorter month, losing the days that no longer exist', () => {
    const r = reshapeRoster(september, 2026, 2); // 28 days
    expect(r.people[0]!.codes).toHaveLength(28);
    expect(r.people[0]!.codes[27]).toBe('D27');
  });

  it('carries the corrected month, which is the key it will be stored under', () => {
    expect(reshapeRoster(september, 2026, 10)).toMatchObject({ year: 2026, month: 10 });
  });

  it('keeps names and row numbers untouched', () => {
    const r = reshapeRoster(september, 2026, 10);
    expect(r.people[0]!.name).toBe('Giulia');
    expect(r.people[0]!.row).toBe(3);
  });
});
