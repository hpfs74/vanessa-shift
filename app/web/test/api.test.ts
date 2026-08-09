import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PAY_SETTINGS, EMPTY_PROFILE } from '@vanessa/core';
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

const JSON_HEADERS = { 'content-type': 'application/json' };

/** The answer as it comes off the wire: a status, a body, and a content-type
 *  the code is entitled to look at. */
function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    headers: JSON_HEADERS,
    ...init,
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readPhoto', () => {
  it('calls the reading endpoint on its own origin, under the forwarded prefix', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ reading: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await api.readPhoto('AAAA');
    // Not a bare '/foto': the CloudFront behaviour is '/foto/*', which only
    // matches paths carrying the literal '/foto/' prefix.
    expect(fetchMock.mock.calls[0][0]).toBe('/foto/leggi');
  });

  // 403 and 404 come back from the distribution as index.html with a 200, for
  // the client router. Without a content-type check that HTML reaches
  // JSON.parse and the screen reads «unexpected token '<'».
  it('an HTML answer with a 200 becomes an Italian sentence, not a parse error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!doctype html><html></html>', {
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );

    const message = await messageOf(api.readPhoto('AAAA'));
    expect(message).not.toMatch(/token|JSON/);
    expect(message).toMatch(/a mano/);
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
    // A body that stops halfway: the content-type promises JSON and the bytes
    // do not deliver it.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('{"reading":')));

    const message = await messageOf(api.readPhoto('AAAA'));
    expect(message).not.toMatch(/JSON/);
    expect(message).toMatch(/a mano/);
  });

  it('keeps the message the service sent, when there is one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ errore: 'Hai gia usato le 10 letture' }, { status: 429 })),
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ reading })));

    expect(await api.readPhoto('AAAA')).toEqual(reading);
  });
});

describe('the API calls', () => {
  it('stay on the page own origin, under the prefix CloudFront forwards', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ pay: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await api.paySettings();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/config');
  });

  // The same collision as on the photo path: a refusal from the API origin
  // comes back through the distribution as the app own HTML with a 200.
  it('an HTML answer with a 200 becomes an Italian sentence, not a parse error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!doctype html><html></html>', {
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );

    const message = await messageOf(api.paySettings());
    expect(message).not.toMatch(/token|JSON/);
    expect(message).toMatch(/a mano/);
  });
});

describe('config', () => {
  it('reads pay, profile and quota in one call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({ pay: EMPTY_PAY_SETTINGS, profile: EMPTY_PROFILE, quota: { used: 2 } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const snapshot = await api.config();

    expect(snapshot.quota.used).toBe(2);
    expect(snapshot.profile).toEqual(EMPTY_PROFILE);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/config');
  });

  it('keeps paySettings working off the same response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({ pay: { ...EMPTY_PAY_SETTINGS, hourlyRate: 9.8 }, profile: EMPTY_PROFILE, quota: { used: 0 } }),
      ),
    );

    expect((await api.paySettings()).hourlyRate).toBe(9.8);
  });
});

describe('saveProfile', () => {
  it('sends the profile inside its own envelope', async () => {
    // The envelope is what tells the API to write one row and leave the
    // other alone.
    const fetchMock = vi.fn().mockResolvedValue(response({ profile: EMPTY_PROFILE }));
    vi.stubGlobal('fetch', fetchMock);

    await api.saveProfile({ ...EMPTY_PROFILE, firstName: 'Vanessa' });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({
      profile: { ...EMPTY_PROFILE, firstName: 'Vanessa' },
    });
  });
});

describe('savePaySettings', () => {
  it('sends the pay settings inside their envelope, and also at the top level', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ pay: EMPTY_PAY_SETTINGS }));
    vi.stubGlobal('fetch', fetchMock);

    await api.savePaySettings({ ...EMPTY_PAY_SETTINGS, hourlyRate: 10 });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const sent = JSON.parse(String(init.body));
    // The envelope: what the updated handler reads.
    expect(sent).toMatchObject({ pay: { ...EMPTY_PAY_SETTINGS, hourlyRate: 10 } });
    // The same fields, also at the top level: what a not-yet-updated handler
    // reads, during the window where the bundle and the Lambda deploy apart.
    expect(sent.hourlyRate).toBe(10);
  });
});

describe('the token on every call', () => {
  // The branch's central claim, and until these two tests nothing asserted
  // it: every other test in this file runs with cleared storage, so
  // `sessioneValida()` is null and `autorizzazione()` returns `{}` — the
  // spread could be deleted from both call sites and the whole suite would
  // stay green while every request in production came back 401.
  //
  // Two tests and not one: `request()` and `readPhoto()` build their headers
  // separately, so neither covers the other.
  const conSessione = () => {
    localStorage.setItem('sessione', JSON.stringify({ idToken: 'IL-TOKEN-ID', scade: 9e12 }));
    const fetchMock = vi.fn().mockResolvedValue(response({ pay: {}, reading: {} }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  /** The headers as `fetch` received them, whatever shape they were passed in. */
  const intestazioni = (fetchMock: ReturnType<typeof vi.fn>): Headers =>
    new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);

  it('request() sends the stored ID token as a bearer token', async () => {
    const fetchMock = conSessione();
    await api.paySettings();
    expect(intestazioni(fetchMock).get('authorization')).toBe('Bearer IL-TOKEN-ID');
  });

  it('readPhoto() sends it too, from headers it builds on its own', async () => {
    const fetchMock = conSessione();
    await api.readPhoto('AAAA');
    expect(intestazioni(fetchMock).get('authorization')).toBe('Bearer IL-TOKEN-ID');
  });
});

describe('the 401 circuit breaker', () => {
  // A CloudFront-rewritten refusal is `r.ok` — its status is 200 — so it
  // must not be mistaken for a real, session-confirming answer. If it were,
  // two of them in a row would reset the breaker's marker between them, and
  // a genuine second 401 right after would still read as attempt one:
  // reloading forever instead of ever tripping the breaker.
  it('two HTML refusals in a row do not confirm the session; a real 401 after them still trips the breaker', async () => {
    vi.stubGlobal('location', { reload: vi.fn() });
    localStorage.setItem('sessione', JSON.stringify({ idToken: 'vecchio', scade: 9e12 }));
    localStorage.setItem('refresh', 'un-refresh-token');

    // A first 401 already happened in the cycle before this one: the breaker
    // spent its one free retry there and kept the refresh token. It has to
    // come from a *different* module instance, because `sessioneRifiutata`
    // allows one reload per document — the page this test is standing in
    // reloaded after that 401, and `api` below is the page that came back.
    // Storage survives the reset, as it survives a reload.
    vi.resetModules();
    (await import('../src/auth.js')).sessioneRifiutata();
    expect(sessionStorage.getItem('riprovaSessione')).not.toBeNull();
    expect(localStorage.getItem('refresh')).toBe('un-refresh-token');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!doctype html><html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    await expect(api.paySettings()).rejects.toThrow();
    await expect(api.paySettings()).rejects.toThrow();

    // Neither refusal was a real answer: the marker from the first 401 must
    // have survived both.
    expect(sessionStorage.getItem('riprovaSessione')).not.toBeNull();
    expect(localStorage.getItem('refresh')).toBe('un-refresh-token');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    await expect(api.paySettings()).rejects.toThrow();

    // The second cycle's refusal: everything is gone now, the refresh token
    // included. What the breaker does from here — the mark that stops the
    // gate — is `auth.test.ts`'s business; this test's job is that the two
    // HTML refusals in the middle did not reset the count.
    expect(localStorage.getItem('refresh')).toBeNull();
    expect(sessionStorage.getItem('riprovaSessione')).toBeNull();
  });
});
