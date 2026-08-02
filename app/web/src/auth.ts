/** Getting in.
 *
 * Authorization code with PKCE against Cognito's managed login. No client
 * secret: one inside a JavaScript bundle is not a secret, and PKCE is what
 * replaces it — a random verifier stays in this tab, only its hash travels,
 * and the code that comes back is worthless without the verifier.
 */

const CHIAVE_SESSIONE = 'sessione';
const CHIAVE_VERIFIER = 'pkce';
const CHIAVE_REFRESH = 'refresh';
const CHIAVE_RIPROVATO = 'riprovaSessione';

/** Config baked in at build time: none of it is secret. */
const POOL_DOMAIN = import.meta.env.VITE_LOGIN_DOMAIN ?? '';
const CLIENT_ID = import.meta.env.VITE_CLIENT_ID ?? '';

export interface Sessione {
  readonly idToken: string;
  /** Epoch ms. */
  readonly scade: number;
}

/** A minute of headroom: a token that dies mid-request is worse than one that
 *  was never sent, because it fails halfway through saving a month. */
const MARGINE_MS = 60_000;

export function sessioneValida(now: number = Date.now()): Sessione | null {
  const raw = localStorage.getItem(CHIAVE_SESSIONE);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Sessione;
    if (typeof s?.idToken !== 'string' || typeof s?.scade !== 'number') return null;
    return s.scade - MARGINE_MS > now ? s : null;
  } catch {
    return null;
  }
}

export function esci(): void {
  localStorage.removeItem(CHIAVE_SESSIONE);
  localStorage.removeItem(CHIAVE_REFRESH);
  sessionStorage.removeItem(CHIAVE_VERIFIER);
  sessionStorage.removeItem(CHIAVE_RIPROVATO);
}

/** A request came back 401 despite a session that looked good a moment ago.
 *  That is far more often a device that slept through the one-minute
 *  margin, or a little clock skew, than an actually revoked session — and
 *  the refresh token, good for the day, still works in that ordinary case.
 *  Throwing it away here would trade a silent renewal for a Face ID prompt
 *  that shouldn't have been needed, which is the exact promise the session
 *  design rests on. So: drop only the ID token, keep the refresh token, and
 *  reload — the gate in main.tsx tries the refresh before concluding there
 *  is no session.
 *
 *  The `sessionStorage` marker is the circuit breaker. If the *renewed*
 *  token also comes back 401, this function runs again with the marker
 *  already set: that is the signal that the refresh token itself is no
 *  good, not the ID token alone, so this time everything is cleared before
 *  reloading, landing on a real login instead of reloading forever. */
export function sessioneRifiutata(): void {
  if (sessionStorage.getItem(CHIAVE_RIPROVATO)) {
    esci();
  } else {
    sessionStorage.setItem(CHIAVE_RIPROVATO, '1');
    localStorage.removeItem(CHIAVE_SESSIONE);
  }
  location.reload();
}

/** Any call that actually succeeds means the session is good again: the
 *  circuit breaker above must not carry over and fire on some unrelated
 *  401 much later as though it were still the same loop. */
export function sessioneConfermata(): void {
  sessionStorage.removeItem(CHIAVE_RIPROVATO);
}

/** Thrown only by the configuration guard below, so `main.tsx` can show its
 *  message verbatim — it already names the cause — while anything else
 *  unexpected gets a generic message instead of an English stack trace on
 *  her screen. */
export class ConfigurazioneMancante extends Error {}

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function verifierEsfida(): Promise<{ verifier: string; challenge: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64url(raw.buffer);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(digest) };
}

/** Belt and braces: `vite.config.ts` is the primary guard and stops a build
 *  that would ship without these, but if a bad build is ever served anyway,
 *  this names the cause instead of letting `new URL()` throw "Invalid URL",
 *  or letting an empty `client_id` reach Cognito's own, unbranded error
 *  page. */
function assicuraConfigurata(): void {
  if (!POOL_DOMAIN || !CLIENT_ID) {
    throw new ConfigurazioneMancante(
      'Configurazione di accesso mancante (VITE_LOGIN_DOMAIN o VITE_CLIENT_ID).',
    );
  }
}

export async function iniziaAccesso(): Promise<void> {
  assicuraConfigurata();
  const { verifier, challenge } = await verifierEsfida();
  // sessionStorage, not localStorage: the verifier belongs to this attempt in
  // this tab, and outliving it buys nothing.
  sessionStorage.setItem(CHIAVE_VERIFIER, verifier);
  const u = new URL(`${POOL_DOMAIN}/oauth2/authorize`);
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email');
  u.searchParams.set('redirect_uri', `${location.origin}/`);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  location.assign(u.toString());
}

/** True when a code was present and exchanged. */
export async function completaAccesso(url: URL = new URL(location.href)): Promise<boolean> {
  const code = url.searchParams.get('code');
  if (!code) return false;
  const verifier = sessionStorage.getItem(CHIAVE_VERIFIER);
  if (!verifier) return false;

  const r = await fetch(`${POOL_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: `${location.origin}/`,
      code_verifier: verifier,
    }),
  });
  if (!r.ok) return false;

  const j = (await r.json()) as {
    id_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  // The ID token, not `access_token` — and not by convention, by necessity.
  // The photo Lambda verifies with `tokenUse: 'id'`, so it takes the ID token
  // alone; the five API Gateway routes are more permissive (their JWT
  // authorizer falls back to `client_id` when `aud` is absent, so they accept
  // either). Store the access token here instead and the five routes keep
  // working — the failure hides behind the half of the app that still
  // functions — while the photo import 401s a signed-in Vanessa forever,
  // with nothing in any test able to see why.
  localStorage.setItem(
    CHIAVE_SESSIONE,
    JSON.stringify({ idToken: j.id_token, scade: Date.now() + j.expires_in * 1000 }),
  );
  // The ID token lives an hour; the refresh token lives the day Task 1
  // configured on the pool. Without keeping it, the day-long session is
  // configured on one side only, and the hourly bounce she was promised
  // wouldn't happen becomes real.
  if (j.refresh_token) localStorage.setItem(CHIAVE_REFRESH, j.refresh_token);
  sessionStorage.removeItem(CHIAVE_VERIFIER);
  // Take the code out of the address bar: it is single-use, but it has no
  // business staying in history or in a shared link.
  history.replaceState({}, '', location.origin + '/');
  return true;
}

/** Renews the ID token from the refresh token, silently, so a session that
 *  outlives the hour does not bounce her back out to Cognito every time she
 *  opens the app during the same day. Returns the renewed session, or `null`
 *  if there was nothing to refresh with or the refresh itself failed — a
 *  failure here means the twenty-four hours are up, which is the design's
 *  intent, not a fault to report to her. */
export async function rinnovaAccesso(): Promise<Sessione | null> {
  const refreshToken = localStorage.getItem(CHIAVE_REFRESH);
  if (!refreshToken) return null;

  let r: Response;
  try {
    r = await fetch(`${POOL_DOMAIN}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      }),
    });
  } catch {
    esci();
    return null;
  }
  if (!r.ok) {
    esci();
    return null;
  }

  try {
    const j = (await r.json()) as { id_token: string; expires_in: number };
    // Cognito does not hand back a new refresh token on this grant: the one
    // already stored keeps working until its own day is up.
    const s: Sessione = { idToken: j.id_token, scade: Date.now() + j.expires_in * 1000 };
    localStorage.setItem(CHIAVE_SESSIONE, JSON.stringify(s));
    return s;
  } catch {
    esci();
    return null;
  }
}
