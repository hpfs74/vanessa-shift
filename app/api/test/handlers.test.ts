import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it } from 'vitest';

import type { IsoDate, ShiftCode } from '@vanessa/core';
import { EMPTY_PAY_SETTINGS } from '@vanessa/core';

import { getConfigWith, getShiftsWith, putConfigWith, putShiftWith } from '../src/handlers.js';
import type { Repo, ShiftRecord } from '../src/repo.js';

/** In-memory repo: the tests never touch the network. */
function fakeRepo() {
  const shifts = new Map<string, ShiftRecord>();
  let pay = EMPTY_PAY_SETTINGS;
  const calls: string[] = [];

  const repo: Repo = {
    async shiftsBetween(from, to) {
      calls.push(`shiftsBetween(${from},${to})`);
      return [...shifts.values()]
        .filter((s) => s.date >= from && s.date <= to)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    },
    async saveShift(s) {
      calls.push(`saveShift(${s.date})`);
      shifts.set(s.date, s);
    },
    async deleteShift(d) {
      calls.push(`deleteShift(${d})`);
      shifts.delete(d);
    },
    async readPaySettings() {
      calls.push('readPaySettings');
      return pay;
    },
    async savePaySettings(p) {
      calls.push('savePaySettings');
      pay = p;
    },
  };
  return { repo, shifts, calls, pay: () => pay };
}

function event(p: Partial<APIGatewayProxyEventV2>): APIGatewayProxyEventV2 {
  return p as APIGatewayProxyEventV2;
}

function body(r: { body?: unknown }): any {
  return JSON.parse(String(r.body));
}

let f: ReturnType<typeof fakeRepo>;
beforeEach(() => {
  f = fakeRepo();
});

describe('GET /shifts', () => {
  it('returns the shifts inside the range', async () => {
    await f.repo.saveShift({ date: '2026-01-05', code: 'M' });
    await f.repo.saveShift({ date: '2026-02-10', code: 'P' });

    const r: any = await getShiftsWith(f.repo)(
      event({ queryStringParameters: { from: '2026-01-01', to: '2026-01-31' } }),
    );

    expect(r.statusCode).toBe(200);
    expect(body(r).shifts).toHaveLength(1);
    expect(body(r).shifts[0]).toMatchObject({ date: '2026-01-05', code: 'M' });
  });

  it('an empty range is not an error', async () => {
    const r: any = await getShiftsWith(f.repo)(
      event({ queryStringParameters: { from: '2026-01-01', to: '2026-01-31' } }),
    );
    expect(r.statusCode).toBe(200);
    expect(body(r).shifts).toEqual([]);
  });

  it('rejects missing or malformed parameters with a 400', async () => {
    for (const q of [
      undefined,
      {},
      { from: '2026-01-01' },
      { from: '01/01/2026', to: '2026-01-31' },
      { from: '2026-02-30', to: '2026-03-01' },
      { from: '2026-13-01', to: '2026-13-02' },
    ]) {
      const r: any = await getShiftsWith(f.repo)(event({ queryStringParameters: q as any }));
      expect(r.statusCode, JSON.stringify(q)).toBe(400);
      expect(body(r).errore).toBeTruthy();
    }
  });

  it('rejects a reversed range', async () => {
    const r: any = await getShiftsWith(f.repo)(
      event({ queryStringParameters: { from: '2026-03-01', to: '2026-01-01' } }),
    );
    expect(r.statusCode).toBe(400);
    expect(body(r).errore).toMatch(/precedere/);
  });

  it('rejects a range longer than a year', async () => {
    const r: any = await getShiftsWith(f.repo)(
      event({ queryStringParameters: { from: '2026-01-01', to: '2027-06-01' } }),
    );
    expect(r.statusCode).toBe(400);
    expect(body(r).errore).toMatch(/troppo ampio/);
  });
});

describe('PUT /shifts/{date}', () => {
  it('saves a shift', async () => {
    const r: any = await putShiftWith(f.repo)(
      event({ pathParameters: { date: '2026-01-05' }, body: JSON.stringify({ code: 'M1' }) }),
    );
    expect(r.statusCode).toBe(200);
    expect(f.shifts.get('2026-01-05')).toMatchObject({ code: 'M1' });
  });

  it('saves the swap fields', async () => {
    await putShiftWith(f.repo)(
      event({
        pathParameters: { date: '2026-01-05' },
        body: JSON.stringify({
          code: 'P',
          originalCode: 'M',
          colleague: 'Giulia',
          swapKind: 'Ho coperto',
          notes: 'cambio chiesto il giorno prima',
        }),
      }),
    );
    expect(f.shifts.get('2026-01-05')).toMatchObject({
      code: 'P',
      originalCode: 'M',
      colleague: 'Giulia',
      swapKind: 'Ho coperto',
    });
  });

  it('an empty code deletes the day instead of storing an empty item', async () => {
    await f.repo.saveShift({ date: '2026-01-05', code: 'M' });
    const r: any = await putShiftWith(f.repo)(
      event({ pathParameters: { date: '2026-01-05' }, body: JSON.stringify({ code: '' }) }),
    );
    expect(r.statusCode).toBe(200);
    expect(body(r).deleted).toBe(true);
    expect(f.shifts.has('2026-01-05')).toBe(false);
  });

  it('deleting a day that is not there is not an error', async () => {
    const r: any = await putShiftWith(f.repo)(
      event({ pathParameters: { date: '2026-07-04' }, body: JSON.stringify({ code: null }) }),
    );
    expect(r.statusCode).toBe(200);
  });

  it('rejects an unknown code', async () => {
    const r: any = await putShiftWith(f.repo)(
      event({ pathParameters: { date: '2026-01-05' }, body: JSON.stringify({ code: 'X' }) }),
    );
    expect(r.statusCode).toBe(400);
    expect(f.shifts.size).toBe(0);
  });

  it('rejects a date that does not exist', async () => {
    const r: any = await putShiftWith(f.repo)(
      event({ pathParameters: { date: '2026-02-30' }, body: JSON.stringify({ code: 'M' }) }),
    );
    expect(r.statusCode).toBe(400);
  });

  it('rejects a missing or non-JSON body', async () => {
    for (const b of [undefined, '', 'not json', '[]', '"a string"']) {
      const r: any = await putShiftWith(f.repo)(
        event({ pathParameters: { date: '2026-01-05' }, body: b as any }),
      );
      expect(r.statusCode, String(b)).toBe(400);
    }
  });

  it('rejects overlong notes without saving anything', async () => {
    const r: any = await putShiftWith(f.repo)(
      event({
        pathParameters: { date: '2026-01-05' },
        body: JSON.stringify({ code: 'M', notes: 'x'.repeat(501) }),
      }),
    );
    expect(r.statusCode).toBe(400);
    expect(f.shifts.size).toBe(0);
  });
});

describe('GET /config', () => {
  it('on an empty table returns empty settings, not an error', async () => {
    const r: any = await getConfigWith(f.repo)();
    expect(r.statusCode).toBe(200);
    expect(body(r).pay.hourlyRate).toBeNull();
    expect(body(r).pay.thirteenthAccrual).toBeCloseTo(1 / 12, 10);
  });
});

describe('PUT /config', () => {
  it('saves valid settings', async () => {
    const r: any = await putConfigWith(f.repo)(
      event({
        body: JSON.stringify({
          hourlyRate: 9.5,
          saturdayPremium: 0.2,
          sundayPremium: 0.3,
          holidayPremium: 0.5,
          thirteenthAccrual: 1 / 12,
          netRatio: 0.72,
        }),
      }),
    );
    expect(r.statusCode).toBe(200);
    expect(f.pay().hourlyRate).toBe(9.5);
    expect(f.pay().netRatio).toBe(0.72);
  });

  it('absent fields stay empty instead of becoming zero', async () => {
    await putConfigWith(f.repo)(event({ body: JSON.stringify({ hourlyRate: 10 }) }));
    expect(f.pay().hourlyRate).toBe(10);
    expect(f.pay().saturdayPremium).toBeNull();
    expect(f.pay().netRatio).toBeNull();
  });

  it('rejects a negative hourly rate', async () => {
    const r: any = await putConfigWith(f.repo)(
      event({ body: JSON.stringify({ hourlyRate: -1 }) }),
    );
    expect(r.statusCode).toBe(400);
  });

  it('rejects percentages outside 0..1', async () => {
    for (const v of [1.5, -0.1, 20]) {
      const r: any = await putConfigWith(f.repo)(
        event({ body: JSON.stringify({ hourlyRate: 10, saturdayPremium: v }) }),
      );
      expect(r.statusCode, String(v)).toBe(400);
    }
  });

  it('rejects non-numeric values', async () => {
    const r: any = await putConfigWith(f.repo)(
      event({ body: JSON.stringify({ hourlyRate: 'ten' }) }),
    );
    expect(r.statusCode).toBe(400);
  });
});

describe('responses', () => {
  it('allow CORS only from the app origin', async () => {
    const r: any = await getConfigWith(f.repo)();
    expect(r.headers['access-control-allow-origin']).toBe('https://vanessa.matteo.cool');
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('a repo failure becomes a 500 without leaking details', async () => {
    const broken: Repo = {
      ...f.repo,
      readPaySettings: async () => {
        throw new Error('DynamoDB: AccessDenied on arn:aws:dynamodb:...');
      },
    };
    const r: any = await getConfigWith(broken)();
    expect(r.statusCode).toBe(500);
    expect(String(r.body)).not.toMatch(/arn:aws/);
  });
});
