import { describe, expect, it, vi } from 'vitest';

import { NotSignedIn, requireSignedInWith } from '../src/token.js';

/** A verifier stub: the library's real one talks to Cognito for the keys. */
function verifierThat(behaviour: 'accepts' | 'refuses') {
  return {
    verify: vi.fn(async (token: string) => {
      if (behaviour === 'refuses' || token === 'guasto') throw new Error('invalid');
      return { sub: 'utente-1' };
    }),
  };
}

describe('requireSignedIn', () => {
  it('lets a request with a valid bearer token through', async () => {
    const v = verifierThat('accepts');
    await expect(
      requireSignedInWith(v)({ authorization: 'Bearer buono' }),
    ).resolves.toBeUndefined();
    expect(v.verify).toHaveBeenCalledWith('buono');
  });

  it('reads the header whatever case it arrives in', async () => {
    // API Gateway lowercases them; a Function URL is not required to.
    const v = verifierThat('accepts');
    await expect(requireSignedInWith(v)({ Authorization: 'Bearer buono' })).resolves.toBeUndefined();
  });

  it('refuses a request with no header at all', async () => {
    const v = verifierThat('accepts');
    await expect(requireSignedInWith(v)({})).rejects.toThrow(NotSignedIn);
    // Nothing behind the check should have run.
    expect(v.verify).not.toHaveBeenCalled();
  });

  it('refuses a header that is not a bearer token', async () => {
    const v = verifierThat('accepts');
    await expect(requireSignedInWith(v)({ authorization: 'Basic abc' })).rejects.toThrow(NotSignedIn);
    expect(v.verify).not.toHaveBeenCalled();
  });

  it('refuses a token the verifier rejects', async () => {
    const v = verifierThat('refuses');
    await expect(requireSignedInWith(v)({ authorization: 'Bearer falso' })).rejects.toThrow(
      NotSignedIn,
    );
  });

  it('turns a verifier failure into NotSignedIn, never into a 500', async () => {
    // A rejected token is an answer about the caller, not a fault of ours: it
    // must not reach `handle` as an unknown error and become "errore interno".
    const v = { verify: vi.fn(async () => { throw new Error('kid non trovato'); }) };
    await expect(requireSignedInWith(v)({ authorization: 'Bearer x' })).rejects.toThrow(NotSignedIn);
  });
});
