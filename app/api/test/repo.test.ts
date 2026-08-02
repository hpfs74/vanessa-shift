import { describe, expect, it } from 'vitest';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { QUOTA_PK, createRepo } from '../src/repo.js';

/** Fake DynamoDB, with only the semantics we care about: ADD on a number,
 *  and a condition evaluated on the item as it was before the update. */
function fakeDoc(max: number) {
  const counts = new Map<string, number>();
  const doc = {
    async send(cmd: { input: Record<string, any> }) {
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
  return { doc: doc as unknown as DynamoDBDocumentClient, counts, max };
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
