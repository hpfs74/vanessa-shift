import { describe, expect, it } from 'vitest';

import { claimsOf } from '../src/claims.js';

/** Builds a token shaped like a real one. The signature is never checked, so
 *  a placeholder is honest here: it is what the function ignores. */
function tokenWith(payload: unknown): string {
  const b64 = (s: string) => {
    // TextEncoder converts the string to UTF-8 bytes, then we Base64-encode them.
    const utf8Bytes = new TextEncoder().encode(s);
    const binaryString = String.fromCharCode(...utf8Bytes);
    return btoa(binaryString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  return `${b64('{"alg":"RS256"}')}.${b64(JSON.stringify(payload))}.firma-non-verificata`;
}

describe('claimsOf', () => {
  it('reads the email out of a token', () => {
    expect(claimsOf(tokenWith({ email: 'vanessa@esempio.it', sub: 'abc' })).email).toBe(
      'vanessa@esempio.it',
    );
  });

  it('survives a token with no email', () => {
    expect(claimsOf(tokenWith({ sub: 'abc' })).email).toBeNull();
  });

  it('survives a malformed token instead of throwing', () => {
    // The account block goes blank; it does not take the screen down with it.
    expect(claimsOf('non-un-token').email).toBeNull();
    expect(claimsOf('a.b.c').email).toBeNull();
    expect(claimsOf('').email).toBeNull();
    expect(claimsOf(null).email).toBeNull();
    expect(claimsOf(undefined).email).toBeNull();
  });

  it('refuses an email that is not a string', () => {
    expect(claimsOf(tokenWith({ email: 42 })).email).toBeNull();
  });

  it('reads a payload with accented characters', () => {
    // Base64 of UTF-8 is not Latin-1: `atob` alone mangles this.
    expect(claimsOf(tokenWith({ email: 'però@esempio.it' })).email).toBe('però@esempio.it');
  });
});
