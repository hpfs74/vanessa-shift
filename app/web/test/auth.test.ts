import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { completaAccesso, esci, sessioneValida, verifierEsfida } from '../src/auth.js';

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
