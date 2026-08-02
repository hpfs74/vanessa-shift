import { afterEach, describe, expect, it, vi } from 'vitest';

/** `PHOTO_URL` is read once, when the module loads: every case stubs the
 *  variable first and then imports a fresh copy of the module. */
async function apiWith(photoUrl: string) {
  vi.stubEnv('VITE_PHOTO_URL', photoUrl);
  vi.resetModules();
  return (await import('../src/api.js')).api;
}

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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('readPhoto', () => {
  it('says so, in Italian, when the address was never filled in', async () => {
    const api = await apiWith('');
    const fetching = vi.fn();
    vi.stubGlobal('fetch', fetching);

    expect(await messageOf(api.readPhoto('AAAA'))).toMatch(/non è configurata/);
    // An empty address makes fetch call the page itself: better not to call.
    expect(fetching).not.toHaveBeenCalled();
  });

  // The reading can take two minutes, from a phone: the timeout and the lost
  // connection are the likely failures, not the rare ones. Uncaught, they
  // reach the screen as the browser's own «Failed to fetch».
  it('a connection that drops becomes an Italian sentence with a way out', async () => {
    const api = await apiWith('https://foto.example/');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const message = await messageOf(api.readPhoto('AAAA'));
    expect(message).not.toMatch(/Failed to fetch/);
    expect(message).toMatch(/Controlla la connessione/);
    expect(message).toMatch(/a mano/);
  });

  it('a body that is not the expected JSON does not surface as a parse error', async () => {
    const api = await apiWith('https://foto.example/');
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
    const api = await apiWith('https://foto.example/');
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
    const api = await apiWith('https://foto.example/');
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
