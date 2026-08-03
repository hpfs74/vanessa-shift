import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccessoRifiutato,
  accessoInterrotto,
  completaAccesso,
  esci,
  giriDiAccesso,
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

  // The trip ended in a session, so it was not a loop. Without this the count
  // would still stand at the next sign-in — hours later, same tab — and the
  // gate would refuse one she is entitled to.
  it('clears the redirect count once the exchange produces a session', async () => {
    sessionStorage.setItem('giriAccesso', '1');
    sessionStorage.setItem('pkce', 'un-verifier');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id_token: 'IL-TOKEN-ID', expires_in: 3600 }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await completaAccesso(new URL('https://esempio.test/?code=un-codice'));

    expect(giriDiAccesso()).toBe(0);
  });

  // Cognito answers the callback with `?error=…&error_description=…` for a
  // disabled user, a client that is not allowed the flow, an unknown scope.
  // Read as "no code" — which is what it was — the gate found no session and
  // sent her straight back to /oauth2/authorize, which returned the same
  // refusal: an endless redirect with the reason unread in the address bar.
  it('turns a refusal from Cognito into a sentence, not another redirect', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const rifiuto = await completaAccesso(
      new URL('https://esempio.test/?error=access_denied&error_description=Utente+disabilitato'),
    ).then(
      () => null,
      (e: unknown) => e,
    );

    expect(rifiuto).toBeInstanceOf(AccessoRifiutato);
    expect((rifiuto as Error).message).toContain('Utente disabilitato');
    // No token exchange was even attempted: there is no code to exchange.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The redirect count is documented as having one meaning — a round trip
  // that produced nothing — and the gate is built on that. A refusal is a
  // round trip that produced an answer, and it has its own sentence, so
  // leaving the count standing would give it a second meaning and make the
  // comments that assert the first one false.
  it('clears the redirect count on a refusal too, which has its own message', async () => {
    sessionStorage.setItem('giriAccesso', '2');

    await completaAccesso(new URL('https://esempio.test/?error=access_denied')).catch(() => {});

    expect(giriDiAccesso()).toBe(0);
  });

  it('falls back to the error code when Cognito sends no description', async () => {
    const rifiuto = await completaAccesso(
      new URL('https://esempio.test/?error=invalid_scope'),
    ).then(
      () => null,
      (e: unknown) => e,
    );

    expect((rifiuto as Error).message).toContain('invalid_scope');
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

  /** A cycle of the breaker is a page: the reload ends one and starts the
   *  next. A fresh module instance is how that is spelt here, because the
   *  guard that allows one reload per document lives in module scope on
   *  purpose — it has to die with the page. `localStorage` and
   *  `sessionStorage` are untouched by the reset, which is exactly what a
   *  reload does to them, so the state that must carry over does. */
  const nuovoGiro = () => {
    vi.resetModules();
    return import('../src/auth.js');
  };

  it('on the first 401 keeps the refresh token and clears only the ID token', async () => {
    const ricarica = reload();
    localStorage.setItem('sessione', JSON.stringify({ idToken: 'vecchio', scade: 9e12 }));
    localStorage.setItem('refresh', 'un-refresh-token');

    (await nuovoGiro()).sessioneRifiutata();

    expect(localStorage.getItem('sessione')).toBeNull();
    expect(localStorage.getItem('refresh')).toBe('un-refresh-token');
    expect(ricarica).toHaveBeenCalledOnce();
  });

  // `location.reload()` queues a navigation and returns: the handlers of the
  // requests already in flight keep running, and if the ID token died they
  // all come back 401. She saved two days in a row on the calendar, each tap
  // its own request — one refusal arriving twice, not two turns of the loop.
  // Counted as two, this spent the whole breaker at once and left her with
  // "chiudi la pagina e riprova più tardi" over an expired token that a
  // silent renewal was about to fix, with the refresh token thrown away.
  it('treats a second 401 arriving before the reload as the same refusal, not the next one', async () => {
    const ricarica = reload();
    localStorage.setItem('sessione', JSON.stringify({ idToken: 'vecchio', scade: 9e12 }));
    localStorage.setItem('refresh', 'un-refresh-token');

    const { sessioneRifiutata: rifiuta, accessoInterrotto: interrotto } = await nuovoGiro();
    rifiuta();
    rifiuta();
    rifiuta();

    // The refresh token is what the next page renews with: it has to still be
    // there, and the breaker must not have latched.
    expect(localStorage.getItem('refresh')).toBe('un-refresh-token');
    expect(interrotto()).toBe(false);
    // And one navigation, not three.
    expect(ricarica).toHaveBeenCalledOnce();
  });

  // The circuit breaker: a renewed token that *also* comes back 401 means
  // the refresh token itself is no good, not just the ID token — so the
  // second cycle clears everything instead of reloading forever.
  it('on a 401 in the next cycle clears everything, breaking the loop', async () => {
    const ricarica = reload();
    localStorage.setItem('sessione', JSON.stringify({ idToken: 'vecchio', scade: 9e12 }));
    localStorage.setItem('refresh', 'un-refresh-token');

    (await nuovoGiro()).sessioneRifiutata();
    // The page reloaded, the gate renewed, and the renewed token is refused
    // too.
    localStorage.setItem('sessione', JSON.stringify({ idToken: 'rinnovato', scade: 9e12 }));
    (await nuovoGiro()).sessioneRifiutata();

    expect(localStorage.getItem('sessione')).toBeNull();
    expect(localStorage.getItem('refresh')).toBeNull();
    expect(ricarica).toHaveBeenCalledTimes(2);
  });

  // The loop this closes: `esci()` has to clear the retry marker, or a real
  // logout would leave the breaker half-tripped. It used to clear the "we
  // have already been all the way round" mark with it, so the fresh login
  // that followed reset the counter, the next call 401'd for the reason that
  // was never about the token, and she was asked for Face ID every few
  // seconds with nothing on the screen.
  it('leaves a mark that esci() does not clear, so the fresh login does not start the loop again', async () => {
    reload();
    localStorage.setItem('sessione', JSON.stringify({ idToken: 'vecchio', scade: 9e12 }));
    localStorage.setItem('refresh', 'un-refresh-token');

    (await nuovoGiro()).sessioneRifiutata();
    // Not after the first cycle: the ordinary case is a renewal that works,
    // and stopping here would take that away.
    expect(accessoInterrotto()).toBe(false);

    (await nuovoGiro()).sessioneRifiutata();
    expect(accessoInterrotto()).toBe(true);

    // And it survives the logout the second cycle itself performed, plus any
    // later one.
    esci();
    expect(accessoInterrotto()).toBe(true);
  });

  // A unit-level guarantee, not a way out for her: once the mark is on, the
  // gate throws before `App` is mounted, so no call goes out and nothing can
  // confirm anything. The way out is closing the tab, which is what the
  // message says. This exists so the mark cannot outlive a session that is
  // demonstrably working — the one window being the race between `setItem`
  // and the navigation.
  it('is cleared by a call that succeeds, so the mark cannot outlive a working session', async () => {
    reload();
    (await nuovoGiro()).sessioneRifiutata();
    (await nuovoGiro()).sessioneRifiutata();
    expect(accessoInterrotto()).toBe(true);

    sessioneConfermata();
    expect(accessoInterrotto()).toBe(false);
  });

  it('a confirmed session resets the breaker, so the next 401 is treated as a first one again', async () => {
    const ricarica = reload();
    localStorage.setItem('refresh', 'un-refresh-token');

    (await nuovoGiro()).sessioneRifiutata(); // first 401: marker set, refresh token kept
    sessioneConfermata(); // a call succeeded in between: marker cleared
    localStorage.setItem('sessione', JSON.stringify({ idToken: 'nuovo', scade: 9e12 }));
    (await nuovoGiro()).sessioneRifiutata(); // an unrelated, later 401: treated as first again

    expect(localStorage.getItem('sessione')).toBeNull();
    expect(localStorage.getItem('refresh')).toBe('un-refresh-token');
    expect(ricarica).toHaveBeenCalledTimes(2);
  });
});
