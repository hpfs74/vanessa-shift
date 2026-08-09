/** The passkey registration page.
 *
 *  Cognito never prompts an account created by an administrator to set up a
 *  passkey — the docs are explicit — so without a link of our own no passkey
 *  is ever registered, and every sign-in falls back to the email code. That
 *  is precisely what happened in production: the pool was configured
 *  correctly the whole time and the feature still never worked once.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The login config lands in module constants at import time, so a test that
 *  wants different values has to re-import the module after stubbing. Same
 *  reason the breaker tests in `auth.test.ts` reset modules. */
const conConfig = async (dominio: string, clientId: string) => {
  vi.stubEnv('VITE_LOGIN_DOMAIN', dominio);
  vi.stubEnv('VITE_CLIENT_ID', clientId);
  vi.resetModules();
  return import('../src/auth.js');
};

const DOMINIO = 'https://auth.vanessa.matteo.cool';
const CLIENT = 'client-di-prova';

describe('urlRegistrazionePasskey', () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it('points at the managed login page that registers a passkey', async () => {
    const { urlRegistrazionePasskey } = await conConfig(DOMINIO, CLIENT);
    const u = new URL(urlRegistrazionePasskey());
    // `/passkeys/add`, not `/oauth2/authorize`: sending her to the authorize
    // endpoint only signs her in again, which is the state she is already in.
    expect(u.origin + u.pathname).toBe(`${DOMINIO}/passkeys/add`);
  });

  it('carries the client id and a redirect back to the app', async () => {
    const { urlRegistrazionePasskey } = await conConfig(DOMINIO, CLIENT);
    const u = new URL(urlRegistrazionePasskey());
    expect(u.searchParams.get('client_id')).toBe(CLIENT);
    // Must match a callback URL registered on the app client, or Cognito
    // refuses the redirect instead of bringing her home.
    expect(u.searchParams.get('redirect_uri')).toBe(`${location.origin}/`);
  });

  it('refuses to build a URL when the login config is missing', async () => {
    // The guard the rest of auth.ts already uses: an empty client id would
    // land on Cognito's own unbranded error page, which explains nothing.
    const { urlRegistrazionePasskey, ConfigurazioneMancante } = await conConfig(DOMINIO, '');
    expect(() => urlRegistrazionePasskey()).toThrow(ConfigurazioneMancante);
  });
});
