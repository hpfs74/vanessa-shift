import { describe, expect, it } from 'vitest';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import type { IsoDate } from '@vanessa/core';
import { EMPTY_PAY_SETTINGS, EMPTY_PROFILE } from '@vanessa/core';

import { CONFIG_PK, CONFIG_SK, PROFILE_SK, QUOTA_PK, createRepo } from '../src/repo.js';

/** Part of DynamoDB's reserved-word list: the words an attribute of this table
 *  could plausibly be called. `count` is on it, and an unescaped reserved word
 *  is rejected before the item is touched — the failure the fake below
 *  reproduces, because it is invisible to a fake that only reads the key. */
const RESERVED = new Set([
  'COUNT',
  'DATE',
  'HASH',
  'ITEMS',
  'KEY',
  'NAME',
  'ORDER',
  'RANGE',
  'SIZE',
  'SOURCE',
  'STATE',
  'STATUS',
  'TIMESTAMP',
  'TTL',
  'VALUE',
  'YEAR',
]);

/** Words in an expression that are syntax, not attribute names. */
const SYNTAX = new Set([
  'SET',
  'ADD',
  'REMOVE',
  'DELETE',
  'AND',
  'OR',
  'NOT',
  'BETWEEN',
  'IN',
  'attribute_not_exists',
  'attribute_exists',
  'begins_with',
  'contains',
  'size',
  'if_not_exists',
  'list_append',
]);

/** What DynamoDB checks before it looks at the item at all: every `#alias` is
 *  declared, and no bare attribute name is a reserved word. */
function validateExpression(expression: string, names: Record<string, string>): void {
  for (const [, alias] of expression.matchAll(/#(\w+)/g)) {
    if (!(`#${alias}` in names)) {
      throw new Error(`ValidationException: expression attribute name #${alias} is not defined`);
    }
  }
  // A bare name is an identifier preceded by neither `#` nor `:`.
  for (const [, , word] of expression.matchAll(/(^|[^#:\w])([A-Za-z]\w*)/g)) {
    if (SYNTAX.has(word!)) continue;
    if (RESERVED.has(word!.toUpperCase())) {
      throw new Error(
        `ValidationException: Invalid expression: Attribute name is a reserved keyword; reserved keyword: ${word}`,
      );
    }
  }
}

/** Fake DynamoDB, with only the semantics we care about: the validation that
 *  precedes the write, ADD on a number, and a condition evaluated on the item
 *  as it was before the update. */
function fakeDoc(max: number) {
  const counts = new Map<string, number>();
  const inputs: Record<string, any>[] = [];
  const doc = {
    async send(cmd: { input: Record<string, any> }) {
      inputs.push(cmd.input);
      const names = cmd.input.ExpressionAttributeNames ?? {};
      validateExpression(String(cmd.input.UpdateExpression), names);
      validateExpression(String(cmd.input.ConditionExpression), names);

      const key = String(cmd.input.Key.sk);
      const current = counts.get(key) ?? 0;
      const limit = Number(cmd.input.ExpressionAttributeValues[':max']);
      if (counts.has(key) && current >= limit) {
        const e = new Error('condizione fallita');
        e.name = 'ConditionalCheckFailedException';
        throw e;
      }
      counts.set(key, current + 1);
      return {};
    },
  };
  return { doc: doc as unknown as DynamoDBDocumentClient, counts, inputs, max };
}

describe('consumePhotoQuota', () => {
  it('grants readings up to the cap and no further', async () => {
    const { doc, counts } = fakeDoc(3);
    const repo = createRepo('tabella', doc);

    expect(await repo.consumePhotoQuota('2026-08-02', 3)).toBe(true);
    expect(await repo.consumePhotoQuota('2026-08-02', 3)).toBe(true);
    expect(await repo.consumePhotoQuota('2026-08-02', 3)).toBe(true);
    expect(await repo.consumePhotoQuota('2026-08-02', 3)).toBe(false);
    expect(counts.get('2026-08-02')).toBe(3);
  });

  it('starts over at zero the next day', async () => {
    const { doc } = fakeDoc(1);
    const repo = createRepo('tabella', doc);

    expect(await repo.consumePhotoQuota('2026-08-02', 1)).toBe(true);
    expect(await repo.consumePhotoQuota('2026-08-02', 1)).toBe(false);
    expect(await repo.consumePhotoQuota('2026-08-03', 1)).toBe(true);
  });

  // Regression: `count` is a reserved word. Written bare, the call is refused
  // with a ValidationException — which is not ConditionalCheckFailedException,
  // so it rethrows and every reading becomes a 500. The four tests above stayed
  // green through it, because none of them looked at the expressions.
  it('escapes the reserved attribute name, keeping the stored name', async () => {
    const { doc, inputs } = fakeDoc(10);
    await createRepo('tabella', doc).consumePhotoQuota('2026-08-02', 10);

    const input = inputs[0]!;
    expect(input.UpdateExpression).toBe('SET expires = :expires ADD #count :one');
    expect(input.ConditionExpression).toBe('attribute_not_exists(#count) OR #count < :max');
    expect(input.ExpressionAttributeNames).toEqual({ '#count': 'count' });
  });

  it('consumes one reading with one call: the condition and the increment are the same write', async () => {
    const { doc, inputs } = fakeDoc(10);
    await createRepo('tabella', doc).consumePhotoQuota('2026-08-02', 10);
    expect(inputs).toHaveLength(1);
  });

  it('writes under the quota key, not among the shifts', async () => {
    const keys: Record<string, unknown>[] = [];
    const doc = {
      async send(cmd: { input: Record<string, any> }) {
        keys.push(cmd.input.Key);
        return {};
      },
    } as unknown as DynamoDBDocumentClient;

    await createRepo('tabella', doc).consumePhotoQuota('2026-08-02', 10);
    expect(keys[0]).toEqual({ pk: QUOTA_PK, sk: '2026-08-02' });
  });

  it('an error that is not the condition propagates, it does not become a silent no', async () => {
    const doc = {
      async send() {
        throw new Error('rete');
      },
    } as unknown as DynamoDBDocumentClient;

    await expect(createRepo('tabella', doc).consumePhotoQuota('2026-08-02', 10)).rejects.toThrow(
      'rete',
    );
  });
});

/** A fake that stores items by key, which is all Get and Put need. The
 *  quota fake above models `ADD` and a condition instead, and neither fake
 *  is a superset of the other. */
function fakeItems() {
  const items = new Map<string, Record<string, unknown>>();
  const doc = {
    async send(cmd: { input: Record<string, any>; constructor: { name: string } }) {
      const key = `${cmd.input.Key?.pk ?? cmd.input.Item?.pk}#${
        cmd.input.Key?.sk ?? cmd.input.Item?.sk
      }`;
      if (cmd.input.Item) {
        items.set(key, cmd.input.Item);
        return {};
      }
      return { Item: items.get(key) };
    },
  };
  return { doc: doc as unknown as DynamoDBDocumentClient, items };
}

describe('profile', () => {
  it('reads an empty profile when nothing was ever saved', async () => {
    const { doc } = fakeItems();
    const repo = createRepo('tabella', doc);
    expect(await repo.readProfile()).toEqual(EMPTY_PROFILE);
  });

  it('saves and reads a profile back', async () => {
    const { doc } = fakeItems();
    const repo = createRepo('tabella', doc);
    const p = {
      ...EMPTY_PROFILE,
      firstName: 'Vanessa',
      hiredOn: '2021-03-12' as IsoDate,
      contractKind: 'indeterminato' as const,
      weeklyHours: 24,
    };
    await repo.saveProfile(p);
    expect(await repo.readProfile()).toEqual(p);
  });

  it('leaves unset fields out of the item instead of storing nulls', async () => {
    // Same convention as a shift's optional attributes: an attribute that is
    // not there reads unambiguously as "not set".
    const { doc, items } = fakeItems();
    const repo = createRepo('tabella', doc);
    await repo.saveProfile({ ...EMPTY_PROFILE, firstName: 'Vanessa' });
    const item = items.get(`${CONFIG_PK}#${PROFILE_SK}`)!;
    expect(item.firstName).toBe('Vanessa');
    expect('lastName' in item).toBe(false);
    expect('weeklyHours' in item).toBe(false);
  });

  it('keeps zero weekly hours, which is a real answer', async () => {
    const { doc } = fakeItems();
    const repo = createRepo('tabella', doc);
    await repo.saveProfile({ ...EMPTY_PROFILE, weeklyHours: 0 });
    expect((await repo.readProfile()).weeklyHours).toBe(0);
  });

  it('drops a stored value that is no longer a declared contract kind', async () => {
    // Whatever is in the table was written by an older version, or by hand.
    // The type promises two values, so anything else reads as unset.
    const { doc, items } = fakeItems();
    items.set(`${CONFIG_PK}#${PROFILE_SK}`, {
      pk: CONFIG_PK,
      sk: PROFILE_SK,
      contractKind: 'stagionale',
    });
    const repo = createRepo('tabella', doc);
    expect((await repo.readProfile()).contractKind).toBeNull();
  });

  it('writes the profile beside the pay settings, not over them', async () => {
    const { doc, items } = fakeItems();
    const repo = createRepo('tabella', doc);
    await repo.savePaySettings({ ...EMPTY_PAY_SETTINGS, hourlyRate: 9.8 });
    await repo.saveProfile({ ...EMPTY_PROFILE, firstName: 'Vanessa' });
    expect(items.get(`${CONFIG_PK}#${CONFIG_SK}`)!.hourlyRate).toBe(9.8);
    expect(items.get(`${CONFIG_PK}#${PROFILE_SK}`)!.firstName).toBe('Vanessa');
  });
});

describe('readPhotoQuota', () => {
  it('is zero before the first reading of the day', async () => {
    const { doc } = fakeItems();
    const repo = createRepo('tabella', doc);
    expect(await repo.readPhotoQuota('2026-08-09')).toBe(0);
  });

  it('reports what the counter row holds', async () => {
    const { doc, items } = fakeItems();
    items.set(`${QUOTA_PK}#2026-08-09`, { pk: QUOTA_PK, sk: '2026-08-09', count: 3 });
    const repo = createRepo('tabella', doc);
    expect(await repo.readPhotoQuota('2026-08-09')).toBe(3);
  });
});

/** A fake holding one item per key. Enough for the roster, which is a whole
 *  item written and read back — no expressions, hence no reserved words. */
function fakeTable() {
  const items = new Map<string, Record<string, any>>();
  const doc = {
    async send(cmd: { input: Record<string, any>; constructor: { name: string } }) {
      const key = `${cmd.input.Key?.pk ?? cmd.input.Item?.pk}#${cmd.input.Key?.sk ?? cmd.input.Item?.sk}`;
      if (cmd.input.Item) {
        items.set(key, cmd.input.Item);
        return {};
      }
      return { Item: items.get(key) };
    },
  } as unknown as DynamoDBDocumentClient;
  return { doc, items };
}

describe('roster', () => {
  const september = {
    year: 2026,
    month: 9,
    people: [
      { name: 'Giulia', row: 3, codes: ['M', 'P', ...Array(28).fill('')] },
      { name: 'Marta', row: null, codes: ['P1', '', ...Array(28).fill('')] },
    ],
  };

  it('round-trips a month', async () => {
    const { doc } = fakeTable();
    const repo = createRepo('tabella', doc);
    await repo.saveRoster(september);
    expect(await repo.readRoster(2026, 9)).toEqual(september);
  });

  it('answers null for a month never imported', async () => {
    const { doc } = fakeTable();
    expect(await createRepo('tabella', doc).readRoster(2026, 9)).toBeNull();
  });

  it('writes under its own key, zero-padded, away from the shifts', async () => {
    const { doc, items } = fakeTable();
    await createRepo('tabella', doc).saveRoster(september);
    expect([...items.keys()]).toEqual(['ROSTER#2026#09']);
  });

  it('stores a month of codes as one string, not thirty attributes', async () => {
    const { doc, items } = fakeTable();
    await createRepo('tabella', doc).saveRoster(september);
    const stored = items.get('ROSTER#2026#09')!;
    expect(typeof stored.people[0].codes).toBe('string');
    expect(stored.people[0].codes.startsWith('M,P,,')).toBe(true);
  });

  // The whole reason this shape was chosen: replacing a month is one Put.
  it('replaces the month wholesale: whoever left the sheet really leaves', async () => {
    const { doc } = fakeTable();
    const repo = createRepo('tabella', doc);
    await repo.saveRoster(september);
    await repo.saveRoster({ ...september, people: [september.people[0]!] });

    const back = await repo.readRoster(2026, 9);
    expect(back!.people.map((p) => p.name)).toEqual(['Giulia']);
  });

  it('keeps the months of one year apart', async () => {
    const { doc } = fakeTable();
    const repo = createRepo('tabella', doc);
    await repo.saveRoster(september);
    await repo.saveRoster({ ...september, month: 10, people: [] });

    expect((await repo.readRoster(2026, 9))!.people).toHaveLength(2);
    expect((await repo.readRoster(2026, 10))!.people).toHaveLength(0);
  });

  // '' .split(',') is [''], not []: without the guard a person with no codes
  // comes back holding one phantom empty code.
  it('round-trips a person with no codes at all, without inventing one', async () => {
    const { doc } = fakeTable();
    const repo = createRepo('tabella', doc);
    await repo.saveRoster({ year: 2026, month: 9, people: [{ name: 'Giulia', row: 3, codes: [] }] });

    const back = await repo.readRoster(2026, 9);
    expect(back!.people[0]!.codes).toEqual([]);
  });
});
