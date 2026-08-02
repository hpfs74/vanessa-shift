import { describe, expect, it, vi } from 'vitest';

import { NotSignedIn, requireSignedInWith } from '../src/token.js';

/** A verifier stub: the library's real one talks to Cognito for the keys. */
function verifierThat(behaviour: 'accepts' | 'refuses') {
  return {
    verify: vi.fn(async () => {
      if (behaviour === 'refuses') throw new Error('invalid');
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

// `aws-jwt-verify`'s real `create` reaches out to Cognito for the pool's
// public keys: mocked here so this stays as network-free as everything else.
vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: vi.fn(() => ({ verify: vi.fn(async () => ({ sub: 'utente-1' })) })),
  },
}));

describe('requireSignedIn (the production entry point)', () => {
  it('builds one ID-token verifier from the environment, and reuses it', async () => {
    process.env.USER_POOL_ID = 'eu-south-1_finto';
    process.env.USER_POOL_CLIENT_ID = 'clientefinto';
    try {
      const { CognitoJwtVerifier } = await import('aws-jwt-verify');
      const { requireSignedIn } = await import('../src/token.js');

      await requireSignedIn({ authorization: 'Bearer buono' });
      await requireSignedIn({ authorization: 'Bearer buono' });

      // `tokenUse: 'id'` is what makes this check accept the same tokens the
      // gateway authorizer does — see the comment on it in token.ts.
      expect(CognitoJwtVerifier.create).toHaveBeenCalledWith({
        userPoolId: 'eu-south-1_finto',
        clientId: 'clientefinto',
        tokenUse: 'id',
      });
      // Once per container, not once per request: building it again would
      // fetch the pool's public keys again every time.
      expect(CognitoJwtVerifier.create).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.USER_POOL_ID;
      delete process.env.USER_POOL_CLIENT_ID;
    }
  });
});
