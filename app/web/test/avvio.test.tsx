/** The gate. It decides whether anything is drawn, and it is the only place
 *  that can turn a failed sign-in into a sentence instead of another trip to
 *  Cognito — so every way round it is an endless loop, and all three of them
 *  were open at some point in this branch: the refusal Cognito explains, the
 *  401 no token cures, and the exchange that never completes. A fourth needed
 *  no loop at all to show nothing: a page the browser restores from bfcache
 *  without running a line of it.
 *
 *  Nothing tested any of it before: the gate lived in `main.tsx`, which runs
 *  the moment it is imported and therefore cannot be imported by a test.
 */

import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** `auth.ts` reads the build-time config into module constants, so the values
 *  have to be in place before it is first imported: hence `resetModules` and
 *  a dynamic import in every test. Without a client id `iniziaAccesso` stops
 *  at its own configuration guard, and "did the gate try to sign in?" would
 *  be unanswerable — which is the question these tests exist to ask. */
async function caricaAvvio() {
  return (await caricaModulo()).avvia;
}

async function caricaModulo() {
  vi.stubEnv('VITE_LOGIN_DOMAIN', 'https://auth.esempio.test');
  vi.stubEnv('VITE_CLIENT_ID', 'unclientfinto');
  vi.resetModules();
  return import('../src/avvio.js');
}

/** Il ripristino da bfcache: il documento torna com'era, nessuno script
 *  riparte, e `pageshow.persisted` e' l'unico segnale che sia successo.
 *  jsdom non costruisce `PageTransitionEvent`, quindi la proprieta' si mette
 *  a mano su un evento normale — e' l'unica cosa che il codice legge. */
function tornaIndietroDallaCache() {
  const e = new Event('pageshow');
  Object.defineProperty(e, 'persisted', { value: true });
  window.dispatchEvent(e);
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
    // And the trip is counted on the way out, which is what lets the next
    // page tell "she came back with nothing" from "she just opened the app".
    expect(sessionStorage.getItem('giriAccesso')).toBe('1');
  });
});

describe('when signing in never completes', () => {
  // No 401 is ever produced on this path — no call to the API is made — so
  // the breaker cannot see it. Cognito redirects back with `?code=`, the
  // token exchange fails, the gate finds no session and sends her round
  // again: Face ID for as long as she keeps looking, nothing on the screen,
  // and the cause visible only in the console.
  //
  // The exchange has three ways to fail and they do not share a line of code:
  // `fetch` rejects, the verifier is gone, Cognito answers non-2xx. All three
  // end on the same sentence, and that sentence promises a console — so all
  // three are checked, not the one that happens to be easiest to stub. The
  // third is the likeliest of them: the token POST is safelisted, so it has
  // no preflight and reaches Cognito even when CORS then hides the answer,
  // which spends the code — and the reload anyone would try next comes back
  // to `invalid_grant`.
  const scambioFallito = [
    ['fetch rifiutato dalla rete o dal CORS', () => vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))],
    ['Cognito che risponde 400', () => vi.fn().mockResolvedValue(new Response('{"error":"invalid_grant"}', { status: 400 }))],
  ] as const;

  for (const [nome, stub] of scambioFallito) {
    it(`si ferma e lascia il motivo in console — ${nome}`, async () => {
      const assign = finestraSu('https://vanessa.test/?code=un-codice');
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      // Two trips already made, both back with nothing: the count is spent.
      sessionStorage.setItem('giriAccesso', '2');
      sessionStorage.setItem('pkce', 'un-verifier');
      vi.stubGlobal('fetch', stub());
      const avvia = await caricaAvvio();

      await avvia(radice);

      expect(assign).not.toHaveBeenCalled();
      expect(radice.textContent).toContain('configurazione');
      // Different words from the breaker's sentence: that one means she gets
      // in and the service refuses her, this one that she never gets in.
      // Sending whoever debugs it to the same place would be wrong for one.
      expect(radice.textContent).not.toContain('rifiuta comunque le richieste');
      // And a first move, which is the one thing the other two messages give
      // her and this one used to withhold.
      expect(radice.textContent).toContain('ricaricare');
      // The message says the reason is in the console, so it has to be there.
      expect(logged).toHaveBeenCalled();
    });
  }

  it('si ferma e lascia il motivo in console — verifier PKCE sparito', async () => {
    const assign = finestraSu('https://vanessa.test/?code=un-codice');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    sessionStorage.setItem('giriAccesso', '2');
    // No `pkce`: the tab that started the sign-in is not the one that came
    // back. `completaAccesso` gives up before the network, so `fetch` must
    // never be reached.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const avvia = await caricaAvvio();

    await avvia(radice);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(radice.textContent).toContain('configurazione');
    expect(logged).toHaveBeenCalled();
  });

  // The catch in the gate calls a connection dropped on the way back from
  // Cognito the ordinary case, not the exotic one — so it has to be given a
  // retry, or the ordinary case ends on a message announcing a fault that is
  // not there, over something a second attempt would have fixed by itself.
  it('dà un secondo tentativo al primo viaggio andato storto, invece di una diagnosi', async () => {
    const assign = finestraSu('https://vanessa.test/?code=un-codice');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sessionStorage.setItem('giriAccesso', '1');
    sessionStorage.setItem('pkce', 'un-verifier');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const avvia = await caricaAvvio();

    await avvia(radice);

    expect(assign).toHaveBeenCalledOnce();
    expect(String(assign.mock.calls[0][0])).toContain('/oauth2/authorize');
    expect(radice.textContent).toBe('');
    // And the second trip is counted, so a second failure does terminate.
    expect(sessionStorage.getItem('giriAccesso')).toBe('2');
  });

  // The counter must not strand her. A session that expires while the tab is
  // open, or simply opening the app again, arrives with a bare URL — no code
  // came back, so there is no failed trip to count — and she is entitled to
  // a sign-in like any other.
  it('does not fire on an ordinary sign-in that follows an earlier one', async () => {
    const assign = finestraSu('https://vanessa.test/');
    sessionStorage.setItem('giriAccesso', '2');
    const avvia = await caricaAvvio();

    await avvia(radice);

    expect(assign).toHaveBeenCalledOnce();
    expect(String(assign.mock.calls[0][0])).toContain('/oauth2/authorize');
    expect(radice.textContent).toBe('');
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

describe('tornando indietro dalla pagina di accesso', () => {
  // `location.assign` congela questo documento con `#root` ancora vuoto —
  // quando siamo partiti non c'era niente da disegnare. Se il browser lo
  // ripristina dalla bfcache invece di rieseguirlo, nessuno script riparte:
  // schermo bianco, nessuna parola, nessun contatore riletto. E' il guasto che
  // questo branch esiste per togliere, arrivato per la porta di servizio.
  //
  // Un test solo per i due rami, e non due: `montaCancello` iscrive un
  // ascoltatore su `window`, che in jsdom sopravvive al test mentre `#root`
  // no. Due test lascerebbero il primo ascoltatore attaccato a un elemento
  // staccato, e a rispondere al `pageshow` del secondo sarebbero in due.
  it('rifà girare il cancello solo se la pagina ripristinata è rimasta vuota', async () => {
    const assign = finestraSu('https://vanessa.test/');
    const { montaCancello } = await caricaModulo();

    montaCancello(radice);
    await vi.waitFor(() => expect(assign).toHaveBeenCalledOnce());

    // Indietro: il documento torna, vuoto, e nessuno lo ha rieseguito.
    assign.mockClear();
    tornaIndietroDallaCache();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledOnce());

    // E non quando c'è già qualcosa sopra: un secondo `createRoot` sullo
    // stesso elemento monterebbe l'app due volte, e una frase già scritta non
    // ha bisogno di essere riscritta.
    assign.mockClear();
    radice.textContent = 'una frase già sullo schermo';
    tornaIndietroDallaCache();
    await new Promise((r) => setTimeout(r, 0));

    expect(assign).not.toHaveBeenCalled();
    expect(radice.textContent).toBe('una frase già sullo schermo');
  });
});
