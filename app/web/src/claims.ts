/** Reads the id token's payload — TO SHOW IT, AND FOR NOTHING ELSE.
 *
 *  IT DOES NOT VERIFY THE SIGNATURE, AND MUST NEVER GATE ANYTHING.
 *
 *  A JWT decoded in the browser is text the browser itself could have
 *  written: it is good for printing an address on a screen, not for
 *  deciding what somebody is allowed to do. A file called `claims.ts` that
 *  hands out an email is an invitation to write an `if` around it, and
 *  whoever opens it in a year will not have read the spec.
 *
 *  The real check exists and is elsewhere: `api/src/token.ts` verifies every
 *  call against the user pool's public keys, and the API Gateway authorizer
 *  does the same for the five routes behind it.
 */

export interface Claims {
  readonly email: string | null;
}

const NESSUNA: Claims = { email: null };

function payloadOf(segment: string): unknown {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  // Base64 of UTF-8, not of Latin-1: `atob` yields bytes, and the decoder
  // turns them back into the characters that were encoded. Skipping this
  // step mangles any accented letter.
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function claimsOf(idToken: string | null | undefined): Claims {
  if (!idToken) return NESSUNA;
  const parts = idToken.split('.');
  if (parts.length !== 3) return NESSUNA;
  try {
    const payload = payloadOf(parts[1]!) as { email?: unknown };
    return { email: typeof payload.email === 'string' ? payload.email : null };
  } catch {
    // A token we cannot read is not a reason to lose the screen: the account
    // block renders empty and everything else still works.
    return NESSUNA;
  }
}
