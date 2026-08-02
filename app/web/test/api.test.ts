import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api.js';

/** The message, whatever the failure was. */
async function messageOf(promise: Promise<unknown>): Promise<string> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof Error)) throw new Error(`expected an Error, got ${String(error)}`);
  return error.message;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readPhoto', () => {
  it('calls the reading endpoint on its own origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ reading: {} }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await api.readPhoto('AAAA');
    expect(fetchMock.mock.calls[0][0]).toBe('/foto');
  });

  // The reading can take two minutes, from a phone: the timeout and the lost
  // connection are the likely failures, not the rare ones. Uncaught, they
  // reach the screen as the browser's own «Failed to fetch».
  it('a connection that drops becomes an Italian sentence with a way out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const message = await messageOf(api.readPhoto('AAAA'));
    expect(message).not.toMatch(/Failed to fetch/);
    expect(message).toMatch(/Controlla la connessione/);
    expect(message).toMatch(/a mano/);
  });

  it('a body that is not the expected JSON does not surface as a parse error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
      }),
    );

    const message = await messageOf(api.readPhoto('AAAA'));
    expect(message).not.toMatch(/JSON/);
    expect(message).toMatch(/a mano/);
  });

  it('keeps the message the service sent, when there is one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve(JSON.stringify({ errore: 'Hai gia usato le 10 letture' })),
      }),
    );

    expect(await messageOf(api.readPhoto('AAAA'))).toBe('Hai gia usato le 10 letture');
  });

  it('returns the reading when the call goes through', async () => {
    const reading = {
      month: 7,
      year: 2026,
      found: true,
      foundName: 'Vanessa',
      foundRow: 14,
      days: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ reading }) }),
    );

    expect(await api.readPhoto('AAAA')).toEqual(reading);
  });
});
