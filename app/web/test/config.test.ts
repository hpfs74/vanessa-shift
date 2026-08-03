/** The build guard's shapes, checked against the values actually committed.
 *
 *  The guard used to insist `VITE_LOGIN_DOMAIN` looked like a Cognito prefix
 *  domain — `https://<prefix>.auth.<region>.amazoncognito.com`. Moving
 *  managed login to a domain of ours is what makes the passkey work at all,
 *  and the guard would then have refused the only correct value there is: a
 *  build that cannot ship the right answer is worse than no guard. Nothing
 *  in the suite noticed, because the guard runs only during `vite build` and
 *  the committed values were never compared against it here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CLIENT_ID_SHAPE, LOGIN_DOMAIN_SHAPE } from '../env-shapes.js';

function leggiEnv(file: string): Record<string, string> {
  // `import.meta.dirname`, not `new URL(file, import.meta.url)`: vite rewrites
  // the latter into an asset reference at transform time, and an `.env` file
  // is not an asset it can resolve, so the path arrives as "undefined".
  const path = join(import.meta.dirname, '..', file);
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

describe('VITE_LOGIN_DOMAIN', () => {
  for (const file of ['.env.production', '.env.development']) {
    it(`the value committed in ${file} passes the guard that would block the deploy`, () => {
      const value = leggiEnv(file).VITE_LOGIN_DOMAIN;
      expect(value).toBeTruthy();
      expect(LOGIN_DOMAIN_SHAPE.test(value)).toBe(true);
    });
  }

  it('both files name the same login domain', () => {
    // There is one pool, so there is one login page. Two values that drift
    // apart make `npm run dev` sign in somewhere the deployed app does not.
    expect(leggiEnv('.env.development').VITE_LOGIN_DOMAIN).toBe(
      leggiEnv('.env.production').VITE_LOGIN_DOMAIN,
    );
  });

  it('sends her to the host the pool actually serves login from, which is also the relying party id', () => {
    // `infra/lib/auth-stack.ts` gives the pool this exact hostname as its
    // custom domain *and* as `passkeyRelyingPartyId` — Cognito requires the
    // two to be the same string. The frontend is the third copy of that
    // name, and the only one no CDK code can keep in step, so it is pinned
    // here: point the browser somewhere else and she lands on a page that
    // is not the pool's, or on none at all.
    const { host, protocol } = new URL(leggiEnv('.env.production').VITE_LOGIN_DOMAIN);
    expect(protocol).toBe('https:');
    // And it is under a domain we control, which is what stops the passkeys
    // from being bound to a name we would one day have to abandon. That does
    // not need an assertion of its own: a suffix check one line under an
    // equality check can never fail while the equality passes, and reads as
    // coverage that is not there.
    expect(host).toBe('auth.vanessa.matteo.cool');
  });

  it('still refuses the empty and the mistyped, which is what it is for', () => {
    // The value that actually took the app down was blank. A path, a
    // trailing slash or a plain-http origin are the neighbouring mistakes.
    for (const bad of [
      '',
      'auth.vanessa.matteo.cool',
      'http://auth.vanessa.matteo.cool',
      'https://auth.vanessa.matteo.cool/',
      'https://auth.vanessa.matteo.cool/oauth2/authorize',
      'https://localhost',
    ]) {
      expect(LOGIN_DOMAIN_SHAPE.test(bad)).toBe(false);
    }
  });
});

describe('VITE_CLIENT_ID', () => {
  it('is deliberately empty until the pool exists, so the build stays red', () => {
    // Not a broken checkout. `VanessaAccesso` has to be deployed first and
    // its `IdClient` output pasted in; filling in a placeholder to make the
    // build go green is the one thing that must not happen.
    expect(leggiEnv('.env.production').VITE_CLIENT_ID).toBe('');
    expect(CLIENT_ID_SHAPE.test('')).toBe(false);
  });

  it('accepts a real client id, and not something merely 26 characters long', () => {
    expect(CLIENT_ID_SHAPE.test('4f7g2h9k1m3n5p8q0r2s4t6u8v')).toBe(true);
    expect(CLIENT_ID_SHAPE.test('4F7G2H9K1M3N5P8Q0R2S4T6U8V')).toBe(false);
    expect(CLIENT_ID_SHAPE.test('4f7g2h9k1m3n5p8q0r2s4t6u8')).toBe(false);
  });
});
