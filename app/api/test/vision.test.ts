import { describe, expect, it } from 'vitest';

import { ROW_NAME } from '@vanessa/core';

import { MODEL, VisionFailed, createVision } from '../src/vision.js';

function clientReturning(response: unknown) {
  const sent: any[] = [];
  const client = {
    messages: {
      async create(body: unknown) {
        sent.push(body);
        return response as never;
      },
    },
  };
  return { client, sent };
}

/** The reading's failure, narrowed rather than cast: `reason` is what the
 *  handler routes on, so the test must stop compiling if it ever goes away. */
async function failureOf(response: unknown): Promise<VisionFailed> {
  const { client } = clientReturning(response);
  const error: unknown = await createVision(client)('AAAA').then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof VisionFailed)) {
    throw new Error(`expected a VisionFailed, got ${String(error)}`);
  }
  return error;
}

const GOOD_RESPONSE = {
  stop_reason: 'end_turn',
  content: [
    { type: 'thinking', thinking: '' },
    { type: 'text', text: '{"month":8,"year":2026,"found":true}' },
  ],
};

describe('createVision', () => {
  it('returns the JSON of the text block, already deserialized', async () => {
    const { client } = clientReturning(GOOD_RESPONSE);
    const out = await createVision(client)('AAAA');
    expect(out).toEqual({ month: 8, year: 2026, found: true });
  });

  // The prompt tells the model what to put in each field. A field name the
  // schema does not declare is an instruction the model must reinterpret
  // before it can follow it — on the one task where the judgement is per cell.
  it('instructs the model with the names the schema declares', async () => {
    const { client, sent } = clientReturning(GOOD_RESPONSE);
    await createVision(client)('AAAA');
    const text: string = sent[0].messages[0].content.find((c: any) => c.type === 'text').text;

    for (const field of ['code', 'confident', 'found', 'days', 'foundName', 'foundRow']) {
      expect(text).toContain(field);
    }
    // The spellings from before the rename, which the schema no longer has.
    for (const stale of [/\bcodice\b/, /\bsicuro\b/, /\btrovata\b/]) {
      expect(text).not.toMatch(stale);
    }
  });

  it('sends image, model, schema and the row name', async () => {
    const { client, sent } = clientReturning(GOOD_RESPONSE);
    await createVision(client)('AAAA');

    const b = sent[0];
    expect(b.model).toBe(MODEL);
    expect(b.output_config.format.type).toBe('json_schema');

    const blocks = b.messages[0].content;
    const image = blocks.find((c: any) => c.type === 'image');
    expect(image.source).toEqual({
      type: 'base64',
      media_type: 'image/jpeg',
      data: 'AAAA',
    });
    const text = blocks.find((c: any) => c.type === 'text').text;
    expect(text).toContain(ROW_NAME);
  });

  it('skips the reasoning blocks and takes the text', async () => {
    const { client } = clientReturning({
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":1}' }],
    });
    expect(await createVision(client)('AAAA')).toEqual({ a: 1 });
  });

  it('a refusal from the model is not JSON to read', async () => {
    const error = await failureOf({ stop_reason: 'refusal', content: [] });
    expect(error.reason).toBe('refusal');
  });

  it('a truncated response is not JSON to read', async () => {
    const error = await failureOf({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"month":8' }],
    });
    expect(error.reason).toBe('truncated');
  });

  it('no text block is an error, not an undefined that travels on', async () => {
    const error = await failureOf({ stop_reason: 'end_turn', content: [] });
    expect(error.reason).toBe('no-text');
  });

  it('text that is not JSON is an error', async () => {
    const error = await failureOf({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'mi dispiace' }],
    });
    expect(error.reason).toBe('not-json');
  });
});
