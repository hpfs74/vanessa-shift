import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  completaAccesso,
  esci,
  rinnovaAccesso,
  sessioneConfermata,
  sessioneRifiutata,
  sessioneValida,
  verifierEsfida,
} from '../src/auth.js';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PKCE', () => {
  it('derives the challenge from the verifier, and not the other way round', async () => {
    const { verifier, challenge } = await verifierEsfida();
    expect(verifier).not.toBe(challenge);
    // base64url: no padding, no + or /
    expect(challenge).not.toMatch(/[+/=]/);
    const { challenge: again } = await verifierEsfida();
    expect(again).not.toBe(challenge);
  });
});

describe('sessioneValida', () => {
  it('is null when nothing was ever stored', () => {
    expect(sessioneValida()).toBeNull();
  });

  it('returns the session while it is still good', () => {
    // scade has to clear now by more than the margin, or this collides with
    // the "about to expire" case below.
    localStorage.setItem('sessione', JSON.stringify({ idToken: 't', scade: 100_000 }));
    expect(sessioneValida(1_000)?.idToken).toBe('t');
  });

  it('is null once it has expired', () => {
    localStorage.setItem('sessione', JSON.stringify({ idToken: 't', scade: 1_000 }));
    expect(sessioneValida(2_000)).toBeNull();
  });

  it('counts a session about to expire as expired', () => {
    // A token that dies during the request in flight is worse than one that
    // was never sent: the call fails halfway through a save.
    localStorage.setItem('sessione', JSON.stringify({ idToken: 't', scade: 60_000 }));
    expect(sessioneValida(59_000)).toBeNull();
  });

  it('is null when what is stored is not a session at all', () => {
    localStorage.setItem('sessione', 'non json');
    expect(sessioneValida()).toBeNull();
  });

  it('forgets everything on the way out', () => {
    localStorage.setItem('sessione', JSON.stringify({ idToken: 't', scade: 9e12 }));
    esci();
    expect(sessioneValida()).toBeNull();
  });
});

describe('completaAccesso', () => {
  // The photo Lambda verifies with `tokenUse: 'id'`: it takes the ID token
  // alone, not the access token, even though the five API Gateway routes
  // would accept either. A future edit reaching for `access_token` — the
  // more familiar name for "the thing you send as a bearer token" — must
  // fail here, not on a phone.
  it('stores the ID token, not the access token', async () => {
    sessionStorage.setItem('pkce', 'un-verifier');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ id_token: 'IL-TOKEN-ID', access_token: 'IL-TOKEN-ACCESS', expires_in: 3600 }),
          { headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const ok = await completaAccesso(new URL('https://esempio.test/?code=un-codice'));

    expect(ok).toBe(true);
    expect(sessioneValida()?.idToken).toBe('IL-TOKEN-ID');
  });
});

describe('rinnovaAccesso', () => {
  // The ID token lives an hour, the refresh token the day the pool was
  // configured for: without this, "she opens the app mid-afternoon" bounces
  // her back out to Cognito instead of renewing silently.
  it('renews an expired session when a refresh token is present', async () => {
    localStorage.setItem('sessione', JSON.stringify({ idToken: 'vecchio', scade: 1 }));
    localStorage.setItem('refresh', 'un-refresh-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id_token: 'IL-TOKEN-RINNOVATO', expires_in: 3600 }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const s = await rinnovaAccesso();

    expect(s?.idToken).toBe('IL-TOKEN-RINNOVATO');
    expect(sessioneValida()?.idToken).toBe('IL-TOKEN-RINNOVATO');
  });

  it('is null with no refresh token to try, and never calls fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await rinnovaAccesso()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A refused refresh is the twenty-four hours being up, not a fault: it
  // clears everything and lets the gate send her to a fresh login, quietly.
  it('clears the session and returns null when the refresh is refused', async () => {
    localStorage.setItem('sessione', JSON.stringify({ idToken: 'vecchio', scade: 1 }));
    localStorage.setItem('refresh', 'un-refresh-token-scaduto');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 400 })));

    const s = await rinnovaAccesso();

    expect(s).toBeNull();
    expect(sessioneValida()).toBeNull();
    expect(localStorage.getItem('refresh')).toBeNull();
  });
});

describe('sessioneRifiutata', () => {
  // jsdom's `Location.prototype.reload` is read-only, so neither `vi.spyOn`
  // nor a plain reassignment can wrap it in place. Stubbing the whole global
  // stands in for it instead — this module only ever calls `.reload()`, so a
  // bare object with that one method is a faithful enough double.
  const reload = () => {
    const spy = vi.fn();
    vi.stubGlobal('location', { reload: spy });
    return spy;
  };

  it('on the first 401 keeps the refresh token and clears only the ID token', () => {
    const ricarica = reload();
    localStorage.setItem('sessione', JSON.stringify({ idToken: 'vecchio', scade: 9e12 }));
    localStorage.setItem('refresh', 'un-refresh-token');

    sessioneRifiutata();

    expect(localStorage.getItem('sessione')).toBeNull();
    expect(localStorage.getItem('refresh')).toBe('un-refresh-token');
    expect(ricarica).toHaveBeenCalledOnce();
  });

  // The circuit breaker: a renewed token that *also* comes back 401 means
  // the refresh token itself is no good, not just the ID token — so the
  // second consecutive call clears everything instead of reloading forever.
  it('on a second consecutive 401 clears everything, breaking the loop', () => {
    const ricarica = reload();
    localStorage.setItem('sessione', JSON.stringify({ idToken: 'vecchio', scade: 9e12 }));
    localStorage.setItem('refresh', 'un-refresh-token');

    sessioneRifiutata();
    sessioneRifiutata();

    expect(localStorage.getItem('sessione')).toBeNull();
    expect(localStorage.getItem('refresh')).toBeNull();
    expect(ricarica).toHaveBeenCalledTimes(2);
  });

  it('a confirmed session resets the breaker, so the next 401 is treated as a first one again', () => {
    const ricarica = reload();
    localStorage.setItem('refresh', 'un-refresh-token');

    sessioneRifiutata(); // first 401: marker set, refresh token kept
    sessioneConfermata(); // a call succeeded in between: marker cleared
    localStorage.setItem('sessione', JSON.stringify({ idToken: 'nuovo', scade: 9e12 }));
    sessioneRifiutata(); // an unrelated, later 401: treated as first again

    expect(localStorage.getItem('sessione')).toBeNull();
    expect(localStorage.getItem('refresh')).toBe('un-refresh-token');
    expect(ricarica).toHaveBeenCalledTimes(2);
  });
});
