import { describe, expect, it } from 'vitest';

import { ROW_NAME } from '@vanessa/core';

import { MODEL, VisionFailed, createVision } from '../src/vision.js';

function clientReturning(risposta: unknown) {
  const sent: any[] = [];
  const client = {
    messages: {
      async create(body: unknown) {
        sent.push(body);
        return risposta as never;
      },
    },
  };
  return { client, sent };
}

const GOOD_RESPONSE = {
  stop_reason: 'end_turn',
  content: [
    { type: 'thinking', thinking: '' },
    { type: 'text', text: '{"mese":8,"anno":2026,"trovata":true}' },
  ],
};

describe('createVision', () => {
  it('returns the JSON of the text block, already deserialized', async () => {
    const { client } = clientReturning(GOOD_RESPONSE);
    const out = await createVision(client)('AAAA');
    expect(out).toEqual({ mese: 8, anno: 2026, trovata: true });
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
    const { client } = clientReturning({ stop_reason: 'refusal', content: [] });
    await expect(createVision(client)('AAAA')).rejects.toThrow(VisionFailed);
  });

  it('a truncated response is not JSON to read', async () => {
    const { client } = clientReturning({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"mese":8' }],
    });
    await expect(createVision(client)('AAAA')).rejects.toThrow(VisionFailed);
  });

  it('no text block is an error, not an undefined that travels on', async () => {
    const { client } = clientReturning({ stop_reason: 'end_turn', content: [] });
    await expect(createVision(client)('AAAA')).rejects.toThrow(VisionFailed);
  });

  it('text that is not JSON is an error', async () => {
    const { client } = clientReturning({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'mi dispiace' }],
    });
    await expect(createVision(client)('AAAA')).rejects.toThrow(VisionFailed);
  });
});
