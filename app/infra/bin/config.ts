/** The names and numbers the three stacks are built from.
 *
 * Its own module, holding constants and nothing else, so a test can read it
 * without building a single stack. It used to live inside `main.ts`, which no
 * test imports — and `loginDomain` here is the third written copy of one
 * hostname (the other two are `passkeyRelyingPartyId` on the pool and
 * `VITE_LOGIN_DOMAIN` in the frontend), so it was the copy nothing could keep
 * in step with the others. `infra/test/config.test.ts` is what does that now.
 */

const DOMAIN = 'vanessa.matteo.cool';

export const CONFIG = {
  account: '495133941005',
  region: 'eu-south-1',
  domain: DOMAIN,
  zoneDomain: 'matteo.cool',
  zoneId: 'Z2T8X72UH7FONU',
  // Managed login, on a hostname of ours. This is also the passkey's relying
  // party id — Cognito requires the two to be the same string once the pool
  // has a custom domain — so it is the name every credential gets bound to,
  // and moving it later means re-enrolling every device. Written under
  // `DOMAIN` because it must be a name we control: Cognito's own
  // `*.amazoncognito.com` would satisfy Cognito and bind the passkeys to
  // someone else's domain.
  loginDomain: `auth.${DOMAIN}`,
} as const;
