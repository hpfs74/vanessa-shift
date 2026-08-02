import { describe, expect, it } from 'vitest';

import {
  type IsoDate,
  type ShiftCode,
  parseSequence,
  planChanges,
  tokenise,
  yearSummary,
  summaryTotals,
} from '../src/index.js';

describe('tokenising a sequence', () => {
  it('accepts commas, spaces, newlines and semicolons alike', () => {
    expect(tokenise('L,M M1;P\nP1')).toEqual(['L', 'M', 'M1', 'P', 'P1']);
  });

  it('ignores stray separators and blank input', () => {
    expect(tokenise(' , ,L,,  M , ')).toEqual(['L', 'M']);
    expect(tokenise('')).toEqual([]);
    expect(tokenise('   ')).toEqual([]);
  });
});

describe('parsing a month sequence', () => {
  it('maps codes onto consecutive days from the first', () => {
    const p = parseSequence(2026, 1, 'M M P1 L');
    expect(p.entries).toEqual([
      { date: '2026-01-01', day: 1, code: 'M' },
      { date: '2026-01-02', day: 2, code: 'M' },
      { date: '2026-01-03', day: 3, code: 'P1' },
      { date: '2026-01-04', day: 4, code: 'L' },
    ]);
    expect(p.unknown).toEqual([]);
    expect(p.tooMany).toBe(false);
    expect(p.daysInMonth).toBe(31);
  });

  it('accepts lower case', () => {
    expect(parseSequence(2026, 1, 'm1 p1 l').entries.map((e) => e.code)).toEqual([
      'M1', 'P1', 'L',
    ]);
  });

  it('reports unknown codes with their position instead of skipping them', () => {
    // Silently dropping a token would shift every later day by one.
    const p = parseSequence(2026, 1, 'M X P');
    expect(p.unknown).toEqual([{ position: 2, token: 'X' }]);
  });

  it('flags a sequence longer than the month', () => {
    const p = parseSequence(2026, 2, Array(30).fill('M').join(' '));
    expect(p.daysInMonth).toBe(28);
    expect(p.tooMany).toBe(true);
    expect(p.entries).toHaveLength(28);
  });

  it('a shorter sequence simply fills the first days', () => {
    const p = parseSequence(2026, 1, 'M M');
    expect(p.entries).toHaveLength(2);
    expect(p.tooMany).toBe(false);
  });

  it('handles February in a leap year', () => {
    const p = parseSequence(2024, 2, Array(29).fill('M').join(' '));
    expect(p.daysInMonth).toBe(29);
    expect(p.entries).toHaveLength(29);
    expect(p.tooMany).toBe(false);
  });

  it('an empty sequence yields nothing, not an error', () => {
    const p = parseSequence(2026, 1, '   ');
    expect(p.entries).toEqual([]);
    expect(p.unknown).toEqual([]);
  });
});

describe('planning the changes', () => {
  it('separates new days, changed days and days already right', () => {
    const existing = new Map<IsoDate, ShiftCode>([
      ['2026-01-01', 'M'],
      ['2026-01-02', 'P'],
    ]);
    const plan = planChanges(parseSequence(2026, 1, 'M P1 L').entries, existing);
    expect(plan.map((c) => c.kind)).toEqual(['same', 'changed', 'new']);
    expect(plan[1]).toMatchObject({ previous: 'P', code: 'P1' });
    expect(plan[2]).toMatchObject({ previous: null, code: 'L' });
  });
});

describe('year summary', () => {
  it('counts shifts per code, worked days and hours per month', () => {
    const shifts = new Map<IsoDate, ShiftCode>([
      ['2026-01-05', 'M'],
      ['2026-01-06', 'M'],
      ['2026-01-07', 'P1'],
      ['2026-01-08', 'L'],
      ['2026-02-02', 'M1'],
    ]);
    const months = yearSummary(2026, shifts);
    expect(months[0]!.perCode.M).toBe(2);
    expect(months[0]!.perCode.P1).toBe(1);
    expect(months[0]!.perCode.L).toBe(1);
    // Libero is not a worked day and adds no hours.
    expect(months[0]!.workedDays).toBe(3);
    expect(months[0]!.totalHours).toBe(6 + 6 + 8);
    expect(months[1]!.workedDays).toBe(1);
    expect(months[11]!.workedDays).toBe(0);
  });

  it('ignores days belonging to another year', () => {
    const shifts = new Map<IsoDate, ShiftCode>([
      ['2026-01-05', 'M'],
      ['2025-01-05', 'M'],
    ]);
    expect(summaryTotals(yearSummary(2026, shifts)).workedDays).toBe(1);
  });

  it('always returns twelve months, even empty ones', () => {
    const months = yearSummary(2026, new Map());
    expect(months).toHaveLength(12);
    expect(months.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(summaryTotals(months).totalHours).toBe(0);
  });

  it('totals add the twelve months up', () => {
    const shifts = new Map<IsoDate, ShiftCode>([
      ['2026-01-05', 'M'],
      ['2026-06-05', 'P1'],
      ['2026-12-05', 'M1'],
    ]);
    const t = summaryTotals(yearSummary(2026, shifts));
    expect(t.workedDays).toBe(3);
    expect(t.totalHours).toBe(6 + 8 + 7);
    expect(t.perCode.M).toBe(1);
  });
});
