/** The gate. It decides whether anything is drawn, and it is the only place
 *  that can turn a failed sign-in into a sentence instead of another trip to
 *  Cognito — so the two ways round it are endless loops, and both used to be
 *  open. Nothing tested it before: it lived in `main.tsx`, which runs the
 *  moment it is imported and therefore cannot be imported by a test.
 */

import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** `auth.ts` reads the build-time config into module constants, so the values
 *  have to be in place before it is first imported: hence `resetModules` and
 *  a dynamic import in every test. Without a client id `iniziaAccesso` stops
 *  at its own configuration guard, and "did the gate try to sign in?" would
 *  be unanswerable — which is the question these tests exist to ask. */
async function caricaAvvio() {
  vi.stubEnv('VITE_LOGIN_DOMAIN', 'https://auth.esempio.test');
  vi.stubEnv('VITE_CLIENT_ID', 'unclientfinto');
  vi.resetModules();
  return (await import('../src/avvio.js')).avvia;
}

/** jsdom's `location` cannot be navigated or reassigned in place. This module
 *  only reads `href`/`origin` and calls `assign`, so a plain object with
 *  those is a faithful enough double. */
function finestraSu(href: string) {
  const assign = vi.fn();
  vi.stubGlobal('location', {
    href,
    origin: new URL(href).origin,
    assign,
    reload: vi.fn(),
  });
  return assign;
}

let radice: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  radice = document.createElement('div');
  document.body.append(radice);
});

afterEach(() => {
  radice.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('when there is no session', () => {
  it('sends her to managed login', async () => {
    // The control for the two tests below: without this one they would pass
    // just as well on a gate that had stopped signing anyone in at all.
    const assign = finestraSu('https://vanessa.test/');
    const avvia = await caricaAvvio();

    await avvia(radice);

    expect(assign).toHaveBeenCalledOnce();
    expect(String(assign.mock.calls[0][0])).toContain('/oauth2/authorize');
  });
});

describe('when the sign-in works and the calls are refused anyway', () => {
  // The loop: 401 → renew → 401 → the breaker clears everything → fresh
  // login → Face ID → session → 401 → the breaker's own mark had been
  // cleared with the rest, so it starts from one again. Every few seconds,
  // for as long as she keeps looking at it, and never a word on the screen.
  it('stops instead of asking for Face ID again, and says so', async () => {
    const assign = finestraSu('https://vanessa.test/');

    // Two 401s in two cycles, each with its own page: `sessioneRifiutata`
    // allows one per document on purpose, so two calls in a row are one
    // refusal arriving twice and do not fire the breaker. A fresh module
    // instance is a fresh page; storage carries over, as a reload leaves it.
    for (const _ of [1, 2]) {
      vi.resetModules();
      (await import('../src/auth.js')).sessioneRifiutata();
    }

    const avvia = await caricaAvvio();
    await avvia(radice);

    expect(assign).not.toHaveBeenCalled();
    expect(radice.textContent).toContain('rifiuta comunque le richieste');
  });
});

describe('when Cognito refuses the sign-in itself', () => {
  it('shows the reason it sent instead of bouncing back to it', async () => {
    const assign = finestraSu(
      'https://vanessa.test/?error=access_denied&error_description=Utente+disabilitato',
    );
    const avvia = await caricaAvvio();

    await avvia(radice);

    expect(assign).not.toHaveBeenCalled();
    expect(radice.textContent).toContain('Utente disabilitato');
  });
});

describe('when there is a session', () => {
  it('draws the app', async () => {
    finestraSu('https://vanessa.test/');
    localStorage.setItem('sessione', JSON.stringify({ idToken: 'buono', scade: 9e12 }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ shifts: [], pay: {} }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const avvia = await caricaAvvio();

    await act(async () => {
      await avvia(radice);
    });

    await waitFor(() => expect(radice.textContent).toContain('Turni di Vanessa'));
  });
});
