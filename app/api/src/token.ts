/** Who is asking.
 *
 * API Gateway checks the token for the five routes it serves, with an
 * authorizer that never reaches our code. A Lambda Function URL cannot have
 * one, so the photo endpoint checks it here instead. Same pool, same tokens,
 * two mechanisms — because of what AWS offers, not by choice.
 */

import { CognitoJwtVerifier } from 'aws-jwt-verify';

/** The request carried no usable token. Distinct from a malformed body: this
 *  one is about the caller, not about what they sent. */
export class NotSignedIn extends Error {}

/** The little the verification needs, so tests do not reach for Cognito's
 *  public keys over the network. */
export interface Verifier {
  verify(token: string): Promise<unknown>;
}

export function requireSignedInWith(verifier: Verifier) {
  return async (headers: Record<string, string | undefined> | undefined): Promise<void> => {
    const raw = Object.entries(headers ?? {}).find(
      ([k]) => k.toLowerCase() === 'authorization',
    )?.[1];
    if (!raw || !raw.toLowerCase().startsWith('bearer ')) {
      throw new NotSignedIn('nessun token');
    }
    try {
      await verifier.verify(raw.slice('bearer '.length));
    } catch {
      // Every failure the library can raise — bad signature, expired, wrong
      // audience, unknown key — means the same thing here: not signed in.
      // Letting it escape would surface as "errore interno", which blames us
      // for something that is about the caller.
      throw new NotSignedIn('token non valido');
    }
  };
}

let shared: ((headers: Record<string, string | undefined> | undefined) => Promise<void>) | null =
  null;

/** The production entry point. The verifier is built once per container: it
 *  caches the pool's public keys, and building it per request would fetch them
 *  again every time. */
export function requireSignedIn(headers: Record<string, string | undefined> | undefined) {
  if (!shared) {
    const userPoolId = process.env.USER_POOL_ID;
    const clientId = process.env.USER_POOL_CLIENT_ID;
    if (!userPoolId || !clientId) throw new Error('USER_POOL_ID / USER_POOL_CLIENT_ID non impostati');
    const verifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: 'id' });
    shared = requireSignedInWith(verifier as unknown as Verifier);
  }
  return shared(headers);
}
