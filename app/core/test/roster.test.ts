import { describe, expect, it } from 'vitest';

import {
  MAX_NAME_LENGTH,
  MAX_ROSTER_PEOPLE,
  countOverlapping,
  normaliseCode,
  overlaps,
  reshapeRoster,
  rosterOnDay,
  validateRoster,
  rosterFromSecondRead,
  validateSecondRead,
  InvalidReading,
  type PhotoReading,
  type SecondRead,
} from '../src/index.js';

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

  // The prompt asks for names "cosi' come sta scritto sul foglio", surname
  // above given name — so a duplicated row arrives as "ROSSI VANESSA", not a
  // bare "Vanessa". `ROW_NAME` alone would miss it; the reading's own
  // `foundName` is what catches it, because it is the same name off the same
  // sheet.
  it('excludes her row under the sheet\'s own written form, via the reading\'s foundName', () => {
    const r = validateRoster(
      {
        others: [
          person('ROSSI VANESSA', Array(30).fill('M')),
          person('BIANCHI GIULIA', Array(30).fill('P')),
        ],
      },
      2026,
      9,
      'ROSSI VANESSA',
    );
    expect(r.people.map((p) => p.name)).toEqual(['BIANCHI GIULIA']);
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

  // Mirrors `normaliseCode`'s own test: a field that wanders costs the
  // field, not the row. This also keeps `requireRosterPeople`'s stricter
  // 80-character check (api/src/http.ts) from ever seeing a name it would
  // refuse — the roster the client saves is exactly what this returned.
  it('truncates a name that wanders instead of dropping the person over it', () => {
    const long = 'M'.repeat(200);
    const r = validateRoster({ others: [person(long, Array(30).fill('M'))] }, 2026, 9);
    expect(r.people).toHaveLength(1);
    expect(r.people[0]!.name).toBe(long.slice(0, MAX_NAME_LENGTH));
    expect(r.people[0]!.name).toHaveLength(MAX_NAME_LENGTH);
  });

  // Same shape as the length cap on a code: a stop, not a rejection. This is
  // also what keeps `requireRosterPeople`'s 60-person cap from ever refusing
  // a whole PUT over a reading this module already accepted.
  it('stops at the people cap instead of growing without bound', () => {
    const many = Array.from({ length: MAX_ROSTER_PEOPLE + 1 }, (_, i) =>
      person(`Persona${i}`, Array(30).fill('M')),
    );
    const r = validateRoster({ others: many }, 2026, 9);
    expect(r.people).toHaveLength(MAX_ROSTER_PEOPLE);
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

/** August 2026, her row as call 1 returns it: a few unread days (null). */
const HER: (string | null)[] = Array.from({ length: 31 }, (_, i) =>
  i % 7 === 6 ? null : (['M', 'P', 'L', 'M1', 'P1', 'M'] as const)[i % 6]!,
);

function readingWith(foundName = 'Vanessa'): PhotoReading {
  return {
    month: 8,
    year: 2026,
    found: true,
    foundName,
    foundRow: 12,
    days: HER.map((code, i) => ({ day: i + 1, code: code as never, confident: true })),
  };
}

const herCodes = () => HER.map((c) => c ?? '');
const ANNA = Array.from({ length: 31 }, (_, i) => ['F', 'N1', 'R', 'M'][i % 4]!);
const SARA = Array.from({ length: 31 }, (_, i) => ['P', 'M'][i % 2]!);

function second(herRow: string[] = herCodes(), herName = 'Vanessa', extra: Partial<SecondRead> = {}): SecondRead {
  return {
    month: 8,
    year: 2026,
    rows: [
      { name: 'Anna', row: 9, codes: ANNA },
      { name: herName, row: 12, codes: herRow },
      { name: 'Sara', row: 7, codes: SARA },
    ],
    ...extra,
  };
}

describe('rosterFromSecondRead', () => {
  it('keeps the roster when her row agrees with call 1, and leaves her out of it', () => {
    const r = rosterFromSecondRead(readingWith(), second());
    expect(r).not.toBeNull();
    expect(r!.year).toBe(2026);
    expect(r!.month).toBe(8);
    expect(r!.people.map((p) => p.name)).toEqual(['Anna', 'Sara']);
  });

  it('throws the roster away when a single cell of her row differs', () => {
    const row = herCodes();
    row[20] = row[20] === 'M' ? 'P' : 'M';
    expect(rosterFromSecondRead(readingWith(), second(row))).toBeNull();
  });

  it('throws the roster away when her row is read one column off', () => {
    const row = ['', ...herCodes().slice(0, 30)];
    expect(rosterFromSecondRead(readingWith(), second(row))).toBeNull();
  });

  // Without reasoning the model writes x where the prompt asks for empty.
  it('treats an x in her row as the empty cell call 1 reports as null', () => {
    const row = herCodes().map((c) => (c === '' ? 'x' : c));
    expect(rosterFromSecondRead(readingWith(), second(row))).not.toBeNull();
  });

  it("stores a colleague's x cells as empty", () => {
    const s = second();
    const withX = { ...s, rows: [{ name: 'Anna', row: 9, codes: ['x', 'X', ...ANNA.slice(2)] }, s.rows[1]!] };
    const r = rosterFromSecondRead(readingWith(), withX);
    expect(r!.people[0]!.codes.slice(0, 3)).toEqual(['', '', 'R']);
  });

  it('keeps codes the app does not model, as written', () => {
    const r = rosterFromSecondRead(readingWith(), second());
    expect(r!.people[0]!.codes.slice(0, 4)).toEqual(['F', 'N1', 'R', 'M']);
  });

  it('is null when the two readings disagree on the month', () => {
    expect(rosterFromSecondRead(readingWith(), second(undefined, undefined, { month: 7 }))).toBeNull();
    expect(rosterFromSecondRead(readingWith(), second(undefined, undefined, { year: 2025 }))).toBeNull();
  });

  it('is null when her row is not among the rows', () => {
    const s = second();
    expect(rosterFromSecondRead(readingWith(), { ...s, rows: [s.rows[0]!, s.rows[2]!] })).toBeNull();
  });

  it("finds her row by the sheet's own spelling, ignoring case and spacing", () => {
    const r = rosterFromSecondRead(readingWith('ROSSI VANESSA'), second(undefined, 'Rossi  Vanessa'));
    expect(r).not.toBeNull();
    expect(r!.people.map((p) => p.name)).toEqual(['Anna', 'Sara']);
  });

  // November 2026 in production: call 1 answered foundName «Vanessa», call 2
  // wrote the whole row label «Vanessa Berni». Her 30 days agreed, and the
  // roster was thrown away all the same because the names were not equal.
  it('finds her row when call 2 writes her full name and call 1 only the first', () => {
    const r = rosterFromSecondRead(readingWith('Vanessa'), second(undefined, 'Vanessa Berni'));
    expect(r).not.toBeNull();
    expect(r!.people.map((p) => p.name)).toEqual(['Anna', 'Sara']);
  });

  it('matches whole words only, not a name that merely starts the same', () => {
    expect(rosterFromSecondRead(readingWith('Vanessa'), second(undefined, 'Vanessandra Berni'))).toBeNull();
  });

  // Two rows that both carry her name: which one is hers is a guess, and an
  // unmeasured roster is not kept.
  it('is null when more than one row carries her name and none is exact', () => {
    const s = second(undefined, 'Vanessa Berni');
    const twin = { name: 'Vanessa Rossi', row: 14, codes: herCodes() };
    expect(rosterFromSecondRead(readingWith('Vanessa'), { ...s, rows: [...s.rows, twin] })).toBeNull();
  });

  // Call 1 can only say L, M, M1, P, P1 or null: an F for her holidays comes
  // back as null there and as F here. Both readings are right.
  it('does not throw the roster away over a code call 1 cannot express', () => {
    const row = herCodes().map((c) => (c === '' ? 'F' : c));
    expect(rosterFromSecondRead(readingWith(), second(row))).not.toBeNull();
  });

  it('still catches a slip that moves a modelled code onto an empty day', () => {
    const row = herCodes();
    const empty = row.indexOf('');
    row[empty] = 'M';
    expect(rosterFromSecondRead(readingWith(), second(row))).toBeNull();
  });

  it('compares the first of two rows that carry her name', () => {
    const wrong = herCodes().map(() => 'L');
    const s = second();
    const twice = (a: string[], b: string[]): SecondRead => ({
      ...s,
      rows: [s.rows[0]!, { name: 'Vanessa', row: 12, codes: a }, { name: 'Vanessa', row: 13, codes: b }],
    });
    expect(rosterFromSecondRead(readingWith(), twice(herCodes(), wrong))).not.toBeNull();
    expect(rosterFromSecondRead(readingWith(), twice(wrong, herCodes()))).toBeNull();
  });
});

describe('validateSecondRead', () => {
  const ok = { month: 8, year: 2026, rows: [{ name: 'Anna', row: 9, codes: ['M'] }] };

  it('returns a well-formed answer as it is', () => {
    expect(validateSecondRead(ok)).toEqual(ok);
  });

  it('throws on a month that is not one', () => {
    expect(() => validateSecondRead({ ...ok, month: 13 })).toThrow(InvalidReading);
  });

  it('throws when rows is not a list', () => {
    expect(() => validateSecondRead({ ...ok, rows: 'x' })).toThrow(InvalidReading);
  });

  it('drops a row it cannot use instead of throwing', () => {
    expect(validateSecondRead({ ...ok, rows: [{ name: 3, row: 1, codes: [] }, ...ok.rows] }).rows).toEqual(ok.rows);
  });

  it('turns a row number that is not an integer into null', () => {
    expect(validateSecondRead({ ...ok, rows: [{ name: 'Anna', row: 2.5, codes: ['M'] }] }).rows[0]!.row).toBeNull();
  });
});
