import { describe, expect, it } from 'vitest';

import {
  type DayRecord,
  hoursDelta,
  knownColleagues,
  normaliseColleague,
  swapReport,
} from '../src/index.js';

const day = (p: Partial<DayRecord> & { date: string; code: DayRecord['code'] }): DayRecord => p;

describe('hour delta', () => {
  it('is zero when the day was not swapped', () => {
    expect(hoursDelta(day({ date: '2026-01-05', code: 'M' }))).toBe(0);
  });

  it('is positive when more was worked than rostered', () => {
    // Rostered M (6h), actually worked P1 (8h).
    expect(hoursDelta(day({ date: '2026-01-05', code: 'P1', originalCode: 'M' }))).toBe(2);
  });

  it('is negative when less was worked than rostered', () => {
    expect(hoursDelta(day({ date: '2026-01-05', code: 'M', originalCode: 'P1' }))).toBe(-2);
  });

  it('is zero for an even swap of equal shifts', () => {
    expect(hoursDelta(day({ date: '2026-01-05', code: 'M1', originalCode: 'P' }))).toBe(0);
  });
});

describe('swap report', () => {
  const days: DayRecord[] = [
    day({ date: '2026-01-05', code: 'P1', originalCode: 'M', colleague: 'Giulia', swapKind: 'Ho coperto' }),
    day({ date: '2026-01-12', code: 'M', originalCode: 'P1', colleague: 'Giulia', swapKind: 'Mi ha coperto' }),
    day({ date: '2026-01-19', code: 'P', originalCode: 'M1', colleague: 'Giulia', swapKind: 'Ho coperto' }),
    day({ date: '2026-02-02', code: 'M', originalCode: 'M', colleague: 'Anna', swapKind: 'Scambio pari' }),
    day({ date: '2026-03-01', code: 'M', colleague: 'Anna' }), // no swap kind: not a swap
  ];

  it('counts each swap kind per colleague', () => {
    const { balances } = swapReport(days);
    const giulia = balances.find((b) => b.colleague === 'Giulia')!;
    expect(giulia.counts['Ho coperto']).toBe(2);
    expect(giulia.counts['Mi ha coperto']).toBe(1);
    expect(giulia.counts['Scambio pari']).toBe(0);
  });

  it('the favour balance is covered-by-me minus covered-by-her', () => {
    const { balances } = swapReport(days);
    expect(balances.find((b) => b.colleague === 'Giulia')!.favourBalance).toBe(1);
    expect(balances.find((b) => b.colleague === 'Anna')!.favourBalance).toBe(0);
  });

  it('the hour balance sums the deltas', () => {
    const { balances } = swapReport(days);
    // +2 (M->P1), -2 (P1->M), 0 (M1->P, both 7h)
    expect(balances.find((b) => b.colleague === 'Giulia')!.hoursBalance).toBe(0);
  });

  it('a day with a colleague but no swap kind is not a swap', () => {
    const report = swapReport(days);
    expect(report.recorded).toBe(4);
    const anna = report.balances.find((b) => b.colleague === 'Anna')!;
    expect(anna.counts['Scambio pari']).toBe(1);
  });

  it('counts swaps that carry no colleague, so they are not lost silently', () => {
    const report = swapReport([
      ...days,
      day({ date: '2026-04-01', code: 'M', originalCode: 'P', swapKind: 'Ho coperto' }),
    ]);
    expect(report.recorded).toBe(5);
    expect(report.named).toBe(4);
    expect(report.unattributed).toBe(1);
  });

  it('treats the same name written differently as one person', () => {
    const report = swapReport([
      day({ date: '2026-01-05', code: 'M', colleague: 'Giulia', swapKind: 'Ho coperto' }),
      day({ date: '2026-01-06', code: 'M', colleague: '  giulia  ', swapKind: 'Ho coperto' }),
      day({ date: '2026-01-07', code: 'M', colleague: 'GIULIA', swapKind: 'Ho coperto' }),
    ]);
    expect(report.balances).toHaveLength(1);
    expect(report.balances[0]!.counts['Ho coperto']).toBe(3);
  });

  it('sorts colleagues by name', () => {
    const { balances } = swapReport(days);
    expect(balances.map((b) => b.colleague)).toEqual(['Anna', 'Giulia']);
  });

  it('is empty when nothing was swapped', () => {
    const report = swapReport([day({ date: '2026-01-05', code: 'M' })]);
    expect(report.balances).toEqual([]);
    expect(report.recorded).toBe(0);
  });
});

describe('colleague names', () => {
  it('collapses stray whitespace', () => {
    expect(normaliseColleague('  Maria   Rosa ')).toBe('Maria Rosa');
  });

  it('lists the names already used, once each, sorted', () => {
    const names = knownColleagues([
      day({ date: '2026-01-05', code: 'M', colleague: 'Giulia' }),
      day({ date: '2026-01-06', code: 'M', colleague: 'anna' }),
      day({ date: '2026-01-07', code: 'M', colleague: 'GIULIA' }),
      day({ date: '2026-01-08', code: 'M' }),
    ]);
    expect(names).toEqual(['anna', 'Giulia']);
  });
});
