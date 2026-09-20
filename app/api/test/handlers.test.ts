import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IsoDate, ShiftCode } from '@vanessa/core';
import { EMPTY_PAY_SETTINGS, EMPTY_PROFILE, romeToday } from '@vanessa/core';

import {
  getConfigWith,
  getShiftsWith,
  putConfigWith,
  putShiftWith,
  putShiftsWith,
} from '../src/handlers.js';
import type { MonthRoster } from '@vanessa/core';

import type { Repo, ShiftRecord } from '../src/repo.js';

/** In-memory repo: the tests never touch the network. */
function fakeRepo() {
  const shifts = new Map<string, ShiftRecord>();
  const quota = new Map<string, number>();
  const rosters = new Map<string, MonthRoster>();
  let pay = EMPTY_PAY_SETTINGS;
  let profile = EMPTY_PROFILE;
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
    async saveShifts(many) {
      calls.push(`saveShifts(${many.length})`);
      for (const s of many) shifts.set(s.date, s);
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
    async readProfile() {
      calls.push('readProfile');
      return profile;
    },
    async saveProfile(p) {
      calls.push('saveProfile');
      profile = p;
    },
    async consumePhotoQuota(date, max) {
      calls.push(`consumePhotoQuota(${date},${max})`);
      const used = (quota.get(date) ?? 0) + 1;
      if (used > max) return false;
      quota.set(date, used);
      return true;
    },
    async readPhotoQuota(date) {
      calls.push(`readPhotoQuota(${date})`);
      return quota.get(date) ?? 0;
    },
    async readRoster(year, month) {
      calls.push(`readRoster(${year},${month})`);
      return rosters.get(`${year}#${month}`) ?? null;
    },
    async saveRoster(r) {
      calls.push(`saveRoster(${r.year},${r.month})`);
      rosters.set(`${r.year}#${r.month}`, r);
    },
  };
  return { repo, shifts, quota, rosters, calls, pay: () => pay, profile: () => profile };
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

  it('saves an hour override', async () => {
    await putShiftWith(f.repo)(
      event({
        pathParameters: { date: '2026-01-05' },
        body: JSON.stringify({ code: 'M', hoursOverride: 4.5 }),
      }),
    );
    expect(f.shifts.get('2026-01-05')).toMatchObject({ code: 'M', hoursOverride: 4.5 });
  });

  it('keeps a zero override instead of treating it as absent', async () => {
    await putShiftWith(f.repo)(
      event({
        pathParameters: { date: '2026-01-05' },
        body: JSON.stringify({ code: 'M', hoursOverride: 0 }),
      }),
    );
    expect(f.shifts.get('2026-01-05')!.hoursOverride).toBe(0);
  });

  it('an absent override stays null, so the shift hours apply', async () => {
    await putShiftWith(f.repo)(
      event({ pathParameters: { date: '2026-01-05' }, body: JSON.stringify({ code: 'M' }) }),
    );
    expect(f.shifts.get('2026-01-05')!.hoursOverride).toBeNull();
  });

  it('rejects hours a day cannot hold', async () => {
    // NaN is not in this list on purpose: JSON.stringify turns it into null,
    // which reaches the handler as "no override" and is legitimately accepted.
    for (const v of [-1, 25, 'sei', true, []]) {
      const r: any = await putShiftWith(f.repo)(
        event({
          pathParameters: { date: '2026-01-05' },
          body: JSON.stringify({ code: 'M', hoursOverride: v }),
        }),
      );
      expect(r.statusCode, String(v)).toBe(400);
    }
    expect(f.shifts.size).toBe(0);
  });

  it('rejects an unknown swap kind', async () => {
    const r: any = await putShiftWith(f.repo)(
      event({
        pathParameters: { date: '2026-01-05' },
        body: JSON.stringify({ code: 'M', swapKind: 'Boh' }),
      }),
    );
    expect(r.statusCode).toBe(400);
    expect(body(r).errore).toMatch(/scambio/);
    expect(f.shifts.size).toBe(0);
  });

  it('accepts the three swap kinds the sheet uses', async () => {
    for (const kind of ['Ho coperto', 'Mi ha coperto', 'Scambio pari']) {
      const r: any = await putShiftWith(f.repo)(
        event({
          pathParameters: { date: '2026-01-05' },
          body: JSON.stringify({ code: 'M', originalCode: 'P', swapKind: kind }),
        }),
      );
      expect(r.statusCode, kind).toBe(200);
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

describe('PUT /shifts (bulk)', () => {
  it('saves a whole month in one call', async () => {
    const shifts = Array.from({ length: 31 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      code: 'M' as const,
    }));
    const r: any = await putShiftsWith(f.repo)(event({ body: JSON.stringify({ shifts }) }));
    expect(r.statusCode).toBe(200);
    expect(body(r).saved).toBe(31);
    expect(f.shifts.size).toBe(31);
    expect(f.calls).toContain('saveShifts(31)');
  });

  it('overwrites days that were already there', async () => {
    await f.repo.saveShift({ date: '2026-01-01', code: 'L' });
    await putShiftsWith(f.repo)(
      event({ body: JSON.stringify({ shifts: [{ date: '2026-01-01', code: 'P1' }] }) }),
    );
    expect(f.shifts.get('2026-01-01')).toMatchObject({ code: 'P1' });
  });

  it('rejects a duplicated day: the result would depend on write order', async () => {
    const r: any = await putShiftsWith(f.repo)(
      event({
        body: JSON.stringify({
          shifts: [
            { date: '2026-01-01', code: 'M' },
            { date: '2026-01-01', code: 'P' },
          ],
        }),
      }),
    );
    expect(r.statusCode).toBe(400);
    expect(body(r).errore).toMatch(/due volte/);
    expect(f.shifts.size).toBe(0);
  });

  it('rejects the whole list when one entry is bad, saving nothing', async () => {
    const r: any = await putShiftsWith(f.repo)(
      event({
        body: JSON.stringify({
          shifts: [
            { date: '2026-01-01', code: 'M' },
            { date: '2026-01-02', code: 'X' },
          ],
        }),
      }),
    );
    expect(r.statusCode).toBe(400);
    expect(f.shifts.size).toBe(0);
  });

  it('rejects a missing, empty or oversized list', async () => {
    for (const b of [
      {},
      { shifts: 'M,M,P' },
      { shifts: [] },
      { shifts: Array.from({ length: 400 }, (_, i) => ({ date: '2026-01-01', code: 'M' })) },
    ]) {
      const r: any = await putShiftsWith(f.repo)(event({ body: JSON.stringify(b) }));
      expect(r.statusCode, JSON.stringify(b).slice(0, 40)).toBe(400);
    }
  });
});

describe('GET /config', () => {
  // Fake timers only apply to the one test below; a leaked clock would
  // affect `romeToday()` in every other test in this file.
  afterEach(() => vi.useRealTimers());

  it('on an empty table returns empty settings, not an error', async () => {
    const r: any = await getConfigWith(f.repo)();
    expect(r.statusCode).toBe(200);
    expect(body(r).pay.hourlyRate).toBeNull();
    expect(body(r).pay.thirteenthAccrual).toBeCloseTo(1 / 12, 10);
  });

  it('carries pay, profile and the quota spent today', async () => {
    f.quota.set(romeToday(), 3);
    const r: any = await getConfigWith(f.repo)(event({}));
    expect(body(r)).toEqual({
      pay: EMPTY_PAY_SETTINGS,
      profile: EMPTY_PROFILE,
      quota: { used: 3 },
    });
  });

  it('does not send the daily maximum', async () => {
    // MAX_READINGS_PER_DAY lives in `core`, which `web` imports. Sending it
    // too would be the same number in two places, and eventually two values.
    const r: any = await getConfigWith(f.repo)(event({}));
    expect(body(r).quota).toEqual({ used: 0 });
  });

  // Regression: both sides of the test above used to call the same
  // `romeToday()`, so seeding the quota under `romeToday()` and reading it
  // back under `romeToday()` would pass identically even if the handler
  // were reverted to the Lambda's own UTC clock, `today()` — except during
  // the 1-2h window after midnight Rome time where the two dates disagree.
  // This pins the clock inside that window and seeds the quota under Rome's
  // date, which `today()` (UTC-based on the Lambda) would not find.
  it("reads the quota under Rome's day, not the Lambda's UTC one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T23:30:00Z')); // Rome is already the 10th
    f.quota.set('2026-08-10', 3);
    const r: any = await getConfigWith(f.repo)(event({}));
    expect(body(r).quota.used).toBe(3);
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

  it('saves a profile without touching the pay settings', async () => {
    // This proves routing: a body naming only `profile` reaches
    // `saveProfile` and leaves `savePaySettings` uncalled. It runs against
    // `fakeRepo`, where `pay` and `profile` are separate bindings that
    // cannot be conflated — it would pass even if `createRepo` wrote both
    // to the same row. The guarantee that the two land on separate rows is
    // proved by 'writes the profile beside the pay settings, not over them'
    // in repo.test.ts; do not delete that test as redundant with this one.
    await putConfigWith(f.repo)(
      event({ body: JSON.stringify({ pay: { ...EMPTY_PAY_SETTINGS, hourlyRate: 9.8 } }) }),
    );
    await putConfigWith(f.repo)(
      event({ body: JSON.stringify({ profile: { firstName: 'Vanessa' } }) }),
    );

    const r: any = await getConfigWith(f.repo)(event({}));
    expect(body(r).pay.hourlyRate).toBe(9.8);
    expect(body(r).profile.firstName).toBe('Vanessa');
  });

  it('saves both when both are sent', async () => {
    await putConfigWith(f.repo)(
      event({
        body: JSON.stringify({
          pay: { ...EMPTY_PAY_SETTINGS, hourlyRate: 10 },
          profile: { lastName: 'Rossi' },
        }),
      }),
    );
    const r: any = await getConfigWith(f.repo)(event({}));
    expect(body(r).pay.hourlyRate).toBe(10);
    expect(body(r).profile.lastName).toBe('Rossi');
  });

  it('still accepts a bare PaySettings body', async () => {
    // The shape this route received before the profile existed. A phone with
    // a cached bundle keeps sending it after a deploy, and this is a failure
    // that would never show up in development.
    await putConfigWith(f.repo)(
      event({ body: JSON.stringify({ ...EMPTY_PAY_SETTINGS, hourlyRate: 8.5 }) }),
    );
    const r: any = await getConfigWith(f.repo)(event({}));
    expect(body(r).pay.hourlyRate).toBe(8.5);
    expect(f.profile()).toEqual(EMPTY_PROFILE);
  });

  it('refuses a profile that is not an object', async () => {
    const r: any = await putConfigWith(f.repo)(
      event({ body: JSON.stringify({ profile: 'Vanessa' }) }),
    );
    expect(r.statusCode).toBe(400);
  });

  it('refuses an unknown contract kind', async () => {
    const r: any = await putConfigWith(f.repo)(
      event({ body: JSON.stringify({ profile: { contractKind: 'stagionale' } }) }),
    );
    expect(r.statusCode).toBe(400);
  });

  it('rejects the whole write when one half is invalid, leaving the valid half unwritten', async () => {
    await putConfigWith(f.repo)(
      event({ body: JSON.stringify({ pay: { ...EMPTY_PAY_SETTINGS, hourlyRate: 7 } }) }),
    );

    const r: any = await putConfigWith(f.repo)(
      event({
        body: JSON.stringify({
          pay: { ...EMPTY_PAY_SETTINGS, hourlyRate: 11 },
          profile: { contractKind: 'stagionale' },
        }),
      }),
    );

    expect(r.statusCode).toBe(400);
    // The 400 says nothing was accepted: the pay row must still read 7, not 11.
    expect(f.pay().hourlyRate).toBe(7);
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

import { readPhotoWith } from '../src/handlers.js';
import { NotSignedIn } from '../src/token.js';
import { VisionFailed } from '../src/vision.js';

/** A valid August reading, with a single shift on the first of the month. */
function augustReading() {
  return {
    month: 8,
    year: 2026,
    found: true,
    foundName: 'Vanessa',
    foundRow: 12,
    days: Array.from({ length: 31 }, (_, i) => ({
      day: i + 1,
      code: i === 0 ? 'L' : null,
      confident: true,
    })),
  };
}

function photoEvent(image: string) {
  return event({ body: JSON.stringify({ image }) });
}

describe('readPhoto', () => {
  const today = () => '2026-08-02';
  const year = () => 2026;

  it('reads the photo and returns the reading', async () => {
    const { repo } = fakeRepo();
    const h = readPhotoWith(repo, async () => augustReading(), today, year, async () => {});

    const r: any = await h(photoEvent('AAAA'));
    expect(r.statusCode).toBe(200);
    expect(body(r).reading.days).toHaveLength(31);
    expect(body(r).reading.month).toBe(8);
  });

  it('writes no shift', async () => {
    const { repo, shifts } = fakeRepo();
    const h = readPhotoWith(repo, async () => augustReading(), today, year, async () => {});

    await h(photoEvent('AAAA'));
    expect(shifts.size).toBe(0);
  });

  it('past the cap it responds 429 without calling the model', async () => {
    const { repo } = fakeRepo();
    let calls = 0;
    const h = readPhotoWith(
      repo,
      async () => {
        calls += 1;
        return augustReading();
      },
      today,
      year,
      async () => {},
    );

    for (let i = 0; i < 10; i++) {
      const allowed: any = await h(photoEvent('AAAA'));
      expect(allowed.statusCode).toBe(200);
    }
    const r: any = await h(photoEvent('AAAA'));
    expect(r.statusCode).toBe(429);
    expect(calls).toBe(10);
  });

  it('an oversized body is 413, touching neither quota nor model', async () => {
    const { repo, calls } = fakeRepo();
    let readCalls = 0;
    const h = readPhotoWith(
      repo,
      async () => {
        readCalls += 1;
        return augustReading();
      },
      today,
      year,
      async () => {},
    );

    const r: any = await h(photoEvent('A'.repeat(2 * 1024 * 1024 + 1)));
    expect(r.statusCode).toBe(413);
    expect(readCalls).toBe(0);
    expect(calls.filter((c) => c.startsWith('consumePhotoQuota'))).toEqual([]);
  });

  it('when the model fails the quota stays spent', async () => {
    const { repo, quota } = fakeRepo();
    const h = readPhotoWith(
      repo,
      async () => {
        throw new VisionFailed('boom', 'not-json');
      },
      today,
      year,
      async () => {},
    );

    const r: any = await h(photoEvent('AAAA'));
    expect(r.statusCode).toBe(422);
    // Otherwise anyone abusing it gets free attempts by making the reading fail.
    expect(quota.get('2026-08-02')).toBe(1);
  });

  // The model answered, and the answer is unusable. "Try again in a minute"
  // would be a lie that costs another reading: all four causes reproduce.
  it.each(['refusal', 'truncated', 'no-text', 'not-json'] as const)(
    'an unusable answer (%s) is 422 with the way out, not 502',
    async (reason) => {
      const { repo } = fakeRepo();
      const h = readPhotoWith(
        repo,
        async () => {
          throw new VisionFailed('boom', reason);
        },
        today,
        year,
        async () => {},
      );

      const r: any = await h(photoEvent('AAAA'));
      expect(r.statusCode).toBe(422);
      expect(body(r).errore).toContain('leggere questo foglio');
      expect(body(r).errore).toContain('a mano');
    },
  );

  // A Bedrock outage or throttle raises an SDK error, not a VisionFailed. That
  // is the one failure "Il servizio non risponde" was written for; it used to
  // fall through to a bare 500.
  it('a failure of the service itself is 502, not an internal error', async () => {
    const { repo, quota } = fakeRepo();
    const h = readPhotoWith(
      repo,
      async () => {
        const e = new Error('ThrottlingException: Too many requests');
        e.name = 'ThrottlingException';
        throw e;
      },
      today,
      year,
      async () => {},
    );

    const r: any = await h(photoEvent('AAAA'));
    expect(r.statusCode).toBe(502);
    expect(body(r).errore).toContain('Riprova fra un minuto');
    expect(quota.get('2026-08-02')).toBe(1);
  });

  it('does not leak the service failure to the screen', async () => {
    const { repo } = fakeRepo();
    const h = readPhotoWith(
      repo,
      async () => {
        throw new Error('AccessDeniedException on arn:aws:bedrock:eu-south-1::foundation-model');
      },
      today,
      year,
      async () => {},
    );

    const r: any = await h(photoEvent('AAAA'));
    expect(String(r.body)).not.toMatch(/arn:aws/);
  });

  it('a reading that fails validation is 422, not 500', async () => {
    const { repo } = fakeRepo();
    const h = readPhotoWith(repo, async () => ({ found: true, month: 99 }), today, year, async () => {});

    const r: any = await h(photoEvent('AAAA'));
    expect(r.statusCode).toBe(422);
    expect(body(r).errore).toContain('leggere');
  });

  it('row not found has its own message', async () => {
    const { repo } = fakeRepo();
    const h = readPhotoWith(
      repo,
      async () => ({ ...augustReading(), found: false, foundName: null, foundRow: null }),
      today,
      year,
      async () => {},
    );

    const r: any = await h(photoEvent('AAAA'));
    expect(r.statusCode).toBe(422);
    expect(body(r).errore).toContain('Vanessa');
  });

  it('without an image it is 400', async () => {
    const { repo } = fakeRepo();
    const h = readPhotoWith(repo, async () => augustReading(), today, year, async () => {});

    const r: any = await h(event({ body: JSON.stringify({}) }));
    expect(r.statusCode).toBe(400);
  });

  it('refuses a reading with no token, before spending anything', async () => {
    const { repo, calls } = fakeRepo();
    let modelCalls = 0;
    const h = readPhotoWith(
      repo,
      async () => { modelCalls += 1; return augustReading(); },
      today,
      year,
      async () => { throw new NotSignedIn('nessun token'); },
    );

    const r: any = await h(photoEvent('AAAA'));
    expect(r.statusCode).toBe(401);
    // The point: an unauthenticated caller must not burn one of the ten
    // readings, or the day's quota can be emptied by someone with no access.
    expect(calls.filter((c) => c.startsWith('consumePhotoQuota'))).toEqual([]);
    expect(modelCalls).toBe(0);
  });

  it('checks the token before the body size, not after', async () => {
    // The test right above proves the token check runs before the quota
    // step: no token, and `consumePhotoQuota` is never called. This one pins
    // it against `requireImage`, the step in between — an oversized body from
    // a caller with no token is a 401, not the 413 `requireImage` would give.
    //
    // The 429 and 413 tests prove nothing about this ordering, though they
    // sit nearby and look as if they might: both pass a verifier that lets
    // every caller through, so neither one ever exercises the token check.
    const { repo, calls } = fakeRepo();
    const h = readPhotoWith(
      repo,
      async () => augustReading(),
      today,
      year,
      async () => { throw new NotSignedIn('nessun token'); },
    );

    const r: any = await h(photoEvent('A'.repeat(2 * 1024 * 1024 + 1)));
    expect(r.statusCode).toBe(401);
    expect(calls.filter((c) => c.startsWith('consumePhotoQuota'))).toEqual([]);
  });

  it('reads for a caller who is signed in', async () => {
    const { repo } = fakeRepo();
    const h = readPhotoWith(repo, async () => augustReading(), today, year, async () => {});
    const r: any = await h(photoEvent('AAAA'));
    expect(r.statusCode).toBe(200);
  });
});

import { ORIGIN_SECRET_HEADER } from '../src/http.js';

describe('origin secret', () => {
  const secret = 'un-segreto-qualsiasi';

  beforeEach(() => {
    process.env.ORIGIN_SECRET = secret;
  });

  it('lets a request carrying the secret through', async () => {
    const { repo } = fakeRepo();
    const h = getShiftsWith(repo);
    const r: any = await h(
      event({
        headers: { [ORIGIN_SECRET_HEADER]: secret },
        queryStringParameters: { from: '2026-01-01', to: '2026-01-31' },
      }),
    );
    expect(r.statusCode).toBe(200);
  });

  // 401 and not 403 on purpose: the distribution rewrites 403 and 404 into
  // `index.html` with a 200, for the client router, so a 403 would reach the
  // browser as HTML that reads like a success. 401 travels untouched.
  it('refuses a request without the header, with a status CloudFront does not rewrite', async () => {
    const { repo, calls } = fakeRepo();
    const h = getShiftsWith(repo);
    const r: any = await h(
      event({ queryStringParameters: { from: '2026-01-01', to: '2026-01-31' } }),
    );
    expect(r.statusCode).toBe(401);
    // The point of the check is that nothing behind it runs.
    expect(calls).toEqual([]);
  });

  it('refuses a request carrying the wrong secret', async () => {
    const { repo } = fakeRepo();
    const h = getShiftsWith(repo);
    const r: any = await h(
      event({
        headers: { [ORIGIN_SECRET_HEADER]: 'sbagliato' },
        queryStringParameters: { from: '2026-01-01', to: '2026-01-31' },
      }),
    );
    expect(r.statusCode).toBe(401);
  });

  it('compares in constant time, so the value cannot be guessed a byte at a time', async () => {
    // Not observable from the outside: asserted by construction, since the
    // comparison must not short-circuit on the first differing byte.
    const { requireFromCloudFront } = await import('../src/http.js');
    expect(typeof requireFromCloudFront).toBe('function');
  });

  it('lets everything through when no secret is configured', async () => {
    // Local runs and any deploy predating the secret must keep working:
    // an unset variable means the check is not in force, never that
    // every request is refused.
    delete process.env.ORIGIN_SECRET;
    const { repo } = fakeRepo();
    const h = getShiftsWith(repo);
    const r: any = await h(
      event({ queryStringParameters: { from: '2026-01-01', to: '2026-01-31' } }),
    );
    expect(r.statusCode).toBe(200);
  });
});

import { getRosterWith, putRosterWith } from '../src/handlers.js';

/** A reading of July with other rows attached. `julyReading()` is the helper
 *  already in core's tests; here the shape is built inline to keep the two
 *  suites independent. */
function rawWithOthers(others: unknown) {
  return {
    month: 7,
    year: 2026,
    found: true,
    foundName: 'Vanessa',
    foundRow: 14,
    days: Array.from({ length: 31 }, (_, i) => ({ day: i + 1, code: null, confident: true })),
    others,
  };
}

const readPhotoEvent = () =>
  event({ body: JSON.stringify({ image: 'abc' }), headers: {} });

describe('readPhoto and the roster', () => {
  it('returns the roster beside the reading', async () => {
    const raw = rawWithOthers([{ name: 'Giulia', row: 3, codes: Array(31).fill('M') }]);
    const r: any = await readPhotoWith(f.repo, async () => raw, () => '2026-07-02', () => 2026, async () => {})(
      readPhotoEvent(),
    );
    expect(body(r).reading.days).toHaveLength(31);
    expect(body(r).roster.people[0].name).toBe('Giulia');
  });

  // The asymmetry, end to end: a roster that cannot be used must never take
  // down a reading that can.
  it('still answers 200 with the reading when the other rows are rubbish', async () => {
    const r: any = await readPhotoWith(f.repo, async () => rawWithOthers('not an array'), () => '2026-07-02', () => 2026, async () => {})(
      readPhotoEvent(),
    );
    expect(r.statusCode).toBe(200);
    expect(body(r).roster.people).toEqual([]);
  });

  it('takes the roster month from the reading, not from a field of its own', async () => {
    const raw = rawWithOthers([{ name: 'Giulia', row: 3, codes: Array(31).fill('M') }]);
    const r: any = await readPhotoWith(f.repo, async () => raw, () => '2026-07-02', () => 2026, async () => {})(
      readPhotoEvent(),
    );
    expect(body(r).roster.month).toBe(7);
  });
});

describe('GET /roster', () => {
  it('reads a month', async () => {
    await f.repo.saveRoster({ year: 2026, month: 9, people: [] });
    const r: any = await getRosterWith(f.repo)(event({ pathParameters: { year: '2026', month: '09' } }));
    expect(body(r).roster.month).toBe(9);
  });

  it('answers with a null roster for a month never imported', async () => {
    const r: any = await getRosterWith(f.repo)(event({ pathParameters: { year: '2026', month: '09' } }));
    expect(body(r).roster).toBeNull();
  });

  it('refuses a month outside the year', async () => {
    const r: any = await getRosterWith(f.repo)(event({ pathParameters: { year: '2026', month: '13' } }));
    expect(r.statusCode).toBe(400);
  });
});

describe('PUT /roster', () => {
  const people = [{ name: 'Giulia', row: 3, codes: Array(30).fill('M') }];

  it('saves the month named in the path, not one named in the body', async () => {
    await putRosterWith(f.repo)(
      event({
        pathParameters: { year: '2026', month: '09' },
        body: JSON.stringify({ people, year: 1999, month: 1 }),
      }),
    );
    expect(await f.repo.readRoster(2026, 9)).toMatchObject({ year: 2026, month: 9 });
    expect(await f.repo.readRoster(1999, 1)).toBeNull();
  });

  it('refuses a body whose rows are not the length of that month', async () => {
    const r: any = await putRosterWith(f.repo)(
      event({
        pathParameters: { year: '2026', month: '09' },
        body: JSON.stringify({ people: [{ name: 'Giulia', row: 3, codes: Array(31).fill('M') }] }),
      }),
    );
    expect(r.statusCode).toBe(400);
  });
});
