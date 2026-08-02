import { describe, expect, it } from 'vitest';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { QUOTA_PK, createRepo } from '../src/repo.js';

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
