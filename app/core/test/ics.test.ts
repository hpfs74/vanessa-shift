import { describe, expect, it } from 'vitest';

import type { DayEntry, IsoDate } from '../src/index.js';
import { contaTurniEsportabili, icsDelMese } from '../src/index.js';

/** A fixed instant, so DTSTAMP is the same on every run. A test that depends
 *  on the clock it runs at is not a test. */
const ORA = new Date('2026-08-13T10:15:00.000Z');

const mese = (giorni: Record<string, DayEntry>): ReadonlyMap<IsoDate, DayEntry> =>
  new Map(Object.entries(giorni) as [IsoDate, DayEntry][]);

describe('icsDelMese', () => {
  it('wraps the events in a calendar', () => {
    const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), 0, ORA);
    expect(out.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(out).toContain('VERSION:2.0');
  });

  it('ends every line with CRLF, which the standard requires', () => {
    // A lone \n is the kind of thing a lenient parser forgives and a strict
    // one rejects, and the strict one is the phone.
    const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), 0, ORA);
    expect(out).not.toMatch(/[^\r]\n/);
  });

  it('turns a morning into a timed event with the shift hours', () => {
    const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), 0, ORA);
    expect(out).toContain('DTSTART:20260813T070000');
    expect(out).toContain('DTEND:20260813T130000');
    expect(out).toContain('SUMMARY:Mattina (M)');
  });

  it('writes times with no Z and no TZID, so the phone reads them locally', () => {
    // Floating time: no conversion, therefore no daylight-saving arithmetic
    // and no hand-written VTIMEZONE to get subtly wrong.
    const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), 0, ORA);
    expect(out).toMatch(/DTSTART:\d{8}T\d{6}\r\n/);
    expect(out).not.toContain('TZID');
    expect(out).not.toContain('VTIMEZONE');
  });

  it('stamps every event with the instant it was built', () => {
    const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code: 'M' } }), 0, ORA);
    expect(out).toContain('DTSTAMP:20260813T101500Z');
  });

  it('skips Libero, which has no hours to put on a clock', () => {
    const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code: 'L' } }), 0, ORA);
    expect(out).not.toContain('BEGIN:VEVENT');
  });

  it('gives the same day the same UID every time it is exported', () => {
    // This is the whole of what separates an update from a duplicate.
    const giorni = mese({ '2026-08-13': { code: 'M' } });
    const primo = icsDelMese(2026, 8, giorni, 0, ORA);
    const secondo = icsDelMese(2026, 8, giorni, 1, new Date('2026-09-01T08:00:00.000Z'));
    expect(primo).toContain('UID:turno-2026-08-13@vanessa.matteo.cool');
    expect(secondo).toContain('UID:turno-2026-08-13@vanessa.matteo.cool');
  });

  it('carries the sequence it was given', () => {
    const giorni = mese({ '2026-08-13': { code: 'M' } });
    expect(icsDelMese(2026, 8, giorni, 0, ORA)).toContain('SEQUENCE:0');
    expect(icsDelMese(2026, 8, giorni, 3, ORA)).toContain('SEQUENCE:3');
  });

  it('puts the alarm on the shifts that start in the morning', () => {
    for (const code of ['M', 'M1'] as const) {
      const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code } }), 0, ORA);
      expect(out, code).toContain('BEGIN:VALARM');
      expect(out, code).toContain('TRIGGER:-PT12H');
    }
  });

  it('leaves the afternoons without one, or it would ring at one in the morning', () => {
    // Twelve hours before a 13:00 start is 01:00. An alarm that wakes a shift
    // worker to tell her about an afternoon shift is worse than no alarm.
    for (const code of ['P', 'P1'] as const) {
      const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code } }), 0, ORA);
      expect(out, code).not.toContain('BEGIN:VALARM');
    }
  });

  it('produces no events for a month with nothing worked in it', () => {
    expect(icsDelMese(2026, 8, mese({}), 0, ORA)).not.toContain('BEGIN:VEVENT');
    expect(icsDelMese(2026, 8, mese({ '2026-08-13': { code: 'L' } }), 0, ORA)).not.toContain(
      'BEGIN:VEVENT',
    );
  });

  it('only exports the month it was asked for', () => {
    const out = icsDelMese(
      2026,
      8,
      mese({ '2026-07-31': { code: 'M' }, '2026-08-01': { code: 'M' }, '2026-09-01': { code: 'M' } }),
      0,
      ORA,
    );
    expect(out).toContain('UID:turno-2026-08-01@');
    expect(out).not.toContain('UID:turno-2026-07-31@');
    expect(out).not.toContain('UID:turno-2026-09-01@');
  });

  it('puts the days in order', () => {
    const out = icsDelMese(
      2026,
      8,
      mese({ '2026-08-20': { code: 'M' }, '2026-08-03': { code: 'P' } }),
      0,
      ORA,
    );
    expect(out.indexOf('turno-2026-08-03')).toBeLessThan(out.indexOf('turno-2026-08-20'));
  });

  it('ignores an hours override, which says how long and not which end moved', () => {
    // The calendar answers "when am I working". The override answers "what
    // did I actually do", and the two are different questions.
    const out = icsDelMese(2026, 8, mese({ '2026-08-13': { code: 'M', hoursOverride: 4 } }), 0, ORA);
    expect(out).toContain('DTSTART:20260813T070000');
    expect(out).toContain('DTEND:20260813T130000');
  });
});

describe('contaTurniEsportabili', () => {
  it('counts the days that will become events', () => {
    expect(
      contaTurniEsportabili(
        2026,
        8,
        mese({ '2026-08-03': { code: 'M' }, '2026-08-04': { code: 'L' }, '2026-08-05': { code: 'P' } }),
      ),
    ).toBe(2);
  });

  it('is zero for a month of Libero, exactly as for an empty one', () => {
    expect(contaTurniEsportabili(2026, 8, mese({ '2026-08-04': { code: 'L' } }))).toBe(0);
    expect(contaTurniEsportabili(2026, 8, mese({}))).toBe(0);
  });
});
