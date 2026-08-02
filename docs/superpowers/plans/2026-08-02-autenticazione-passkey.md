# Autenticazione con passkey — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Si entra nell'app col volto, e chi non è Vanessa non entra affatto.

**Architecture:** Un user pool Cognito con passkey e verifica biometrica obbligatoria. Le cinque rotte dell'API stanno dietro un authorizer JWT di API Gateway; la Lambda della foto, che un authorizer non lo può avere, verifica il token da sé. Il frontend fa authorization code + PKCE contro Managed Login e allega il token a ogni chiamata.

**Tech Stack:** CDK, Cognito (feature plan Essentials), API Gateway HTTP API, `aws-jwt-verify`, React + Vite.

Spec: `docs/superpowers/specs/2026-08-02-autenticazione-passkey-design.md`.

## Global Constraints

- Identificatori, commenti e descrizioni dei test in inglese. In italiano solo quello che legge Vanessa.
- Gli identificatori dei construct CDK **esistenti** non si toccano: rinominarli distrugge la risorsa. I nuovi sono liberi.
- `npm test`, `npm run typecheck` e `npm run build` dalla cartella `app/` devono passare prima di ogni commit.
- Nessun `cdk deploy` durante l'implementazione. `cdk synth` è l'unico comando CDK che serve.
- La verifica del token nella Lambda foto va **prima** della dimensione del corpo, prima della quota e prima di Bedrock: rifiutare non deve costare, e soprattutto non deve consumare una delle dieci letture del giorno.
- Il segreto d'origine introdotto per CloudFront **resta**: risponde a «da quale porta sei entrato», non a «chi sei».
- L'app **non** diventa multiutente. Nessun handler filtra per utente, nessuna chiave cambia.

## Cosa esiste già, e va lasciato stare

- `web/src/api.ts` chiama `/api` e `/foto/leggi` sulla propria origine, e ha `requireJson` che distingue una risposta vera dall'HTML dell'app. Quel controllo resta e diventa più importante: un 401 dall'authorizer non passa da CloudFront come HTML, ma la funzione copre anche i casi che non conosciamo.
- `api/src/http.ts` ha `requireFromCloudFront`, che verifica il segreto d'origine e risponde 401 quando manca. **Non è autenticazione** e non va confuso con quella che si aggiunge qui.
- Baseline: 260 test verdi, 2 saltati.

---

### Task 1: lo user pool

Nessun codice dell'app lo usa ancora. Alla fine di questo task esiste un pool con la passkey configurata, e nient'altro cambia.

**Files:**
- Create: `app/infra/lib/auth-stack.ts`
- Create: `app/infra/test/auth-stack.test.ts`
- Modify: `app/infra/bin/main.ts`

**Interfaces:**
- Produces: `AuthStack` con `userPoolId: string`, `userPoolClientId: string`, `loginDomain: string`; output CloudFormation `IdPool`, `IdClient`, `DominioLogin`.

- [ ] **Step 1: Scrivi i test che falliscono**

Crea `app/infra/test/auth-stack.test.ts`:

```ts
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import { AuthStack } from '../lib/auth-stack.js';
import { CONFIG } from '../bin/main.js';

let auth: Template;

beforeAll(() => {
  const a = new App();
  const s = new AuthStack(a, 'Auth', {
    env: { account: CONFIG.account, region: CONFIG.region },
    domain: CONFIG.domain,
  });
  auth = Template.fromStack(s);
});

describe('user pool', () => {
  it('accepts a passkey as a way in, and demands the face rather than the unlock', () => {
    // `required` is the whole point: without it a passkey is satisfied by a
    // phone that happens to be unlocked, which is not what was asked for.
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: Match.objectLike({
        SignInPolicy: { AllowedFirstAuthFactors: Match.arrayWith(['PASSWORD', 'WEB_AUTHN', 'EMAIL_OTP']) },
      }),
      WebAuthnUserVerification: 'required',
      WebAuthnRelyingPartyId: CONFIG.domain,
    });
  });

  it('is on the feature plan that has passkeys at all', () => {
    // Lite does not have them. This is the reason for the plan, not a taste.
    auth.hasResourceProperties('AWS::Cognito::UserPool', { UserPoolTier: 'ESSENTIALS' });
  });

  it('does not let anyone sign themselves up', () => {
    // One or two users, created by hand. An open pool on a public address is
    // an invitation.
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: Match.objectLike({ AllowAdminCreateUserOnly: true }),
    });
  });

  it('survives the stack being deleted', () => {
    // The users, their passkeys and their history are not re-creatable.
    auth.hasResource('AWS::Cognito::UserPool', { DeletionPolicy: 'Retain' });
  });

  it('gives the browser a client with no secret', () => {
    // A client secret inside a JavaScript bundle is not a secret.
    auth.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: Match.absent(),
      AllowedOAuthFlows: ['code'],
      CallbackURLs: [`https://${CONFIG.domain}/`],
      LogoutURLs: [`https://${CONFIG.domain}/`],
    });
  });

  it('expires the session in a day, and the tokens sooner', () => {
    // A day is one Face ID in the morning. The natural OAuth behaviour is to
    // never ask again, which also means a lost phone stays in for months.
    auth.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      RefreshTokenValidity: 1,
      TokenValidityUnits: Match.objectLike({ RefreshToken: 'days' }),
      AccessTokenValidity: 60,
      IdTokenValidity: 60,
    });
  });

  it('allows the sign-in flow the passkey needs', () => {
    // USER_AUTH is the choice-based flow; without it the passkey is
    // configured on the pool and unreachable from the client.
    auth.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_AUTH']),
    });
  });
});
```

- [ ] **Step 2: Esegui e verifica che falliscano**

Run: `cd app && npx vitest run --root infra infra/test/auth-stack.test.ts`
Expected: FAIL — `../lib/auth-stack.js` non esiste.

- [ ] **Step 3: Scrivi `infra/lib/auth-stack.ts`**

```ts
/** Who gets in. A user pool, a passkey, and a login page.
 *
 * Its own stack because its lifetime is not the app's: the users, their
 * registered devices and their history cannot be re-created by a deploy, and a
 * stack that can be torn down and rebuilt must not be the one holding them.
 */

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AccountRecovery,
  FeaturePlan,
  OAuthScope,
  PasskeyUserVerification,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
} from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

export interface AuthStackProps extends StackProps {
  readonly domain: string;
}

export class AuthStack extends Stack {
  readonly userPoolId: string;
  readonly userPoolClientId: string;
  readonly loginDomain: string;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const pool = new UserPool(this, 'Utenti', {
      signInAliases: { email: true },
      // One or two people, created by hand. An open pool on a public address
      // is an invitation.
      selfSignUpEnabled: false,
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      // Passkeys do not exist on the Lite plan. This is the reason for the
      // plan, not a preference.
      featurePlan: FeaturePlan.ESSENTIALS,
      signInPolicy: {
        // `password` is not optional — Cognito's own API says "This must be
        // true". A password therefore always exists and always works: the
        // passkey is the pleasant route, not the only one. Generate it long
        // and random, and keep it in a password manager.
        password: true,
        // The bootstrap: a passkey cannot be registered on an account that
        // does not exist yet.
        emailOtp: true,
        passkey: true,
      },
      passkeyRelyingPartyId: props.domain,
      // `required` is the whole point. Without it a passkey is satisfied by a
      // phone that happens to be unlocked, which is not what was asked for.
      passkeyUserVerification: PasskeyUserVerification.REQUIRED,
      // The users, their passkeys and their history are not re-creatable.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const client = new UserPoolClient(this, 'ClienteWeb', {
      userPool: pool,
      // No secret: one inside a JavaScript bundle is not a secret. The browser
      // uses authorization code with PKCE instead.
      generateSecret: false,
      authFlows: { user: true },
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL],
        callbackUrls: [`https://${props.domain}/`],
        logoutUrls: [`https://${props.domain}/`],
      },
      // A day, so she touches Face ID once in the morning. OAuth's natural
      // behaviour is to never ask again, which is more convenient and leaves a
      // lost phone signed in for months.
      refreshTokenValidity: Duration.days(1),
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
    });

    const login = pool.addDomain('DominioAccesso', {
      cognitoDomain: { domainPrefix: 'turni-vanessa' },
    });

    this.userPoolId = pool.userPoolId;
    this.userPoolClientId = client.userPoolClientId;
    this.loginDomain = login.baseUrl();

    new CfnOutput(this, 'IdPool', { value: pool.userPoolId });
    new CfnOutput(this, 'IdClient', { value: client.userPoolClientId });
    new CfnOutput(this, 'DominioLogin', { value: login.baseUrl() });
  }
}
```

- [ ] **Step 4: Collega lo stack in `infra/bin/main.ts`**

Dopo il `CertificateStack` e prima dell'`AppStack`:

```ts
const auth = new AuthStack(app, 'VanessaAccesso', {
  env: { account: CONFIG.account, region: CONFIG.region },
  domain: CONFIG.domain,
});
```

Aggiungi l'import in cima. Non passare ancora niente all'`AppStack`: quello è il Task 2.

- [ ] **Step 5: Esegui i test e sintetizza**

Run: `cd app && npx vitest run --root infra && cd infra && npx cdk synth VanessaAccesso > /dev/null && echo ok`
Expected: PASS e `ok`.

Se `npx cdk synth` si lamenta di `passkeyUserVerification` o `signInPolicy`, la versione di aws-cdk-lib nel lockfile non li ha: **fermati e segnalalo**, non aggirare con un escape hatch `Cfn` senza dirlo.

- [ ] **Step 6: Commit**

```bash
git add app/infra/lib/auth-stack.ts app/infra/test/auth-stack.test.ts app/infra/bin/main.ts
git commit -m "feat: lo user pool, con la passkey e il volto obbligatorio"
```

---

### Task 2: l'API dietro l'authorizer, e la Lambda foto che si verifica da sé

**Files:**
- Modify: `app/infra/lib/app-stack.ts`
- Modify: `app/infra/bin/main.ts`
- Modify: `app/infra/test/stacks.test.ts`
- Create: `app/api/src/token.ts`
- Create: `app/api/test/token.test.ts`
- Modify: `app/api/src/handlers.ts`
- Modify: `app/api/test/handlers.test.ts`
- Modify: `app/api/package.json`

**Interfaces:**
- Consumes: `AuthStack.userPoolId`, `AuthStack.userPoolClientId`.
- Produces: da `token.js`, `class NotSignedIn extends Error` e `requireSignedIn(headers: Record<string, string | undefined> | undefined): Promise<void>`.

- [ ] **Step 1: Aggiungi la dipendenza**

```bash
cd app && npm install --workspace @vanessa/api aws-jwt-verify
```

`aws-jwt-verify` è la libreria di AWS per questo: scarica le chiavi pubbliche del pool, le tiene in cache e verifica firma, scadenza, emittente e destinatario. Verificare un JWT a mano è il genere di codice che sembra giusto e non lo è.

- [ ] **Step 2: Scrivi i test del token**

Crea `app/api/test/token.test.ts`:

```ts
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
```

- [ ] **Step 3: Esegui e verifica che falliscano**

Run: `cd app && npx vitest run --root api api/test/token.test.ts`
Expected: FAIL — `../src/token.js` non esiste.

- [ ] **Step 4: Scrivi `api/src/token.ts`**

```ts
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
```

- [ ] **Step 5: Chiama la verifica in `readPhoto`, per prima**

In `app/api/src/handlers.ts`, dentro `readPhotoWith`, come **prima** istruzione del blocco `handle(async () => {`:

```ts
      await requireSignedIn(event.headers);
```

Prima della dimensione del corpo, prima della quota, prima di Bedrock. Rifiutare non deve costare, e soprattutto non deve consumare una delle dieci letture del giorno: altrimenti chiunque conosca l'indirizzo le esaurisce tutte senza avere accesso a niente.

Aggiungi l'import, e in `http.ts` il ramo nuovo in `handle`, **sopra** quello di `NotFromCloudFront`:

```ts
    if (e instanceof NotSignedIn) return failure(401, 'accesso non effettuato');
```

Perché 401 e non 403: CloudFront riscrive 403 e 404 in `index.html` con 200, e il frontend si troverebbe HTML dove aspetta JSON — lo stesso motivo per cui il rifiuto d'origine risponde 401.

- [ ] **Step 6: Aggiungi i test dell'handler**

In `app/api/test/handlers.test.ts`, nella describe di `readPhoto`, sostituisci l'iniezione così: `readPhotoWith` prende un parametro nuovo per la verifica, con default alla vera. Firma:

```ts
export function readPhotoWith(
  repo: Repo,
  vision: Vision,
  today: () => IsoDate = romeToday,
  year: () => number = () => new Date().getFullYear(),
  signedIn: (h: Record<string, string | undefined> | undefined) => Promise<void> = requireSignedIn,
)
```

Test nuovi:

```ts
  it('refuses a reading with no token, before spending anything', async () => {
    const { repo, calls } = fakeRepo();
    let modelCalls = 0;
    const h = readPhotoWith(
      repo,
      async () => { modelCalls += 1; return augustReading(); },
      today,
      year,
      async () => { throw new NotSignedIn('nessun token'); },
    );

    const r: any = await h(photoEvent('AAAA'));
    expect(r.statusCode).toBe(401);
    // The point: an unauthenticated caller must not burn one of the ten
    // readings, or the day's quota can be emptied by someone with no access.
    expect(calls.filter((c) => c.startsWith('consumePhotoQuota'))).toEqual([]);
    expect(modelCalls).toBe(0);
  });

  it('reads for a caller who is signed in', async () => {
    const { repo } = fakeRepo();
    const h = readPhotoWith(repo, async () => augustReading(), today, year, async () => {});
    const r: any = await h(photoEvent('AAAA'));
    expect(r.statusCode).toBe(200);
  });
```

Tutti i test già esistenti di `readPhoto` passano `async () => {}` come quinto argomento.

- [ ] **Step 7: Metti l'authorizer sulle cinque rotte**

In `app/infra/lib/app-stack.ts`, aggiungi ai props:

```ts
  readonly userPoolId: string;
  readonly userPoolClientId: string;
```

Import:

```ts
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
```

Prima delle rotte:

```ts
    // The five API routes are checked by the gateway, before our code runs.
    // The photo function cannot have this — a Function URL takes no
    // authorizer — so it verifies the same token itself; see api/src/token.ts.
    const authorizer = new HttpJwtAuthorizer(
      'Autorizzatore',
      `https://cognito-idp.${this.region}.amazonaws.com/${props.userPoolId}`,
      { jwtAudience: [props.userPoolClientId] },
    );
```

e passalo a ogni `api.addRoutes` dentro l'helper `route`, come `authorizer`.

Passa pool id e client id all'ambiente della Lambda foto:

```ts
        USER_POOL_ID: props.userPoolId,
        USER_POOL_CLIENT_ID: props.userPoolClientId,
```

In `infra/bin/main.ts`, passa `userPoolId: auth.userPoolId` e `userPoolClientId: auth.userPoolClientId` all'`AppStack`, e aggiungi `app.addDependency` implicito lasciando che il riferimento lo crei da sé.

- [ ] **Step 8: Test dell'infrastruttura**

In `app/infra/test/stacks.test.ts` aggiorna il `beforeAll` per passare i due nuovi props (valori finti vanno bene: `'eu-south-1_finto'` e `'clientefinto'`), e aggiungi:

```ts
describe('chi entra', () => {
  it('puts an authorizer on all five API routes', () => {
    const routes = app.findResources('AWS::ApiGatewayV2::Route');
    expect(Object.keys(routes)).toHaveLength(5);
    for (const r of Object.values(routes)) {
      expect(r.Properties.AuthorizationType).toBe('JWT');
      expect(r.Properties.AuthorizerId).toBeDefined();
    }
  });

  it('points the authorizer at the pool, and at our client alone', () => {
    app.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      JwtConfiguration: Match.objectLike({ Audience: ['clientefinto'] }),
    });
  });

  it('tells the photo function which pool to check against', () => {
    // It cannot have an authorizer, so it needs to verify the token itself.
    app.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.readPhoto',
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          USER_POOL_ID: 'eu-south-1_finto',
          USER_POOL_CLIENT_ID: 'clientefinto',
        }),
      }),
    });
  });
});
```

- [ ] **Step 9: Esegui tutto e sintetizza**

Run: `cd app && npm test && npm run typecheck && cd infra && npx cdk synth VanessaApp > /dev/null && echo ok`
Expected: PASS e `ok`.

- [ ] **Step 10: Commit**

```bash
git add app/api/src/token.ts app/api/test/token.test.ts app/api/src/handlers.ts app/api/src/http.ts app/api/test/handlers.test.ts app/api/package.json app/package-lock.json app/infra/lib/app-stack.ts app/infra/bin/main.ts app/infra/test/stacks.test.ts
git commit -m "feat: l'API vuole un token, e la foto se lo verifica da sola"
```

---

### Task 3: il frontend fa il login

**Files:**
- Create: `app/web/src/auth.ts`
- Create: `app/web/test/auth.test.ts`
- Modify: `app/web/src/api.ts`
- Modify: `app/web/src/App.tsx`
- Modify: `app/web/src/main.tsx`
- Modify: `app/web/test/app.test.tsx`
- Modify: `app/web/index.html` (config del pool)

**Interfaces:**
- Produces: da `auth.js`
  - `interface Sessione { idToken: string; scade: number }`
  - `sessioneValida(now?: number): Sessione | null`
  - `iniziaAccesso(): Promise<void>` — genera PKCE e manda a Cognito
  - `completaAccesso(url: URL): Promise<boolean>` — scambia il codice, vero se l'ha fatto
  - `esci(): void`

- [ ] **Step 1: Scrivi i test di PKCE e sessione**

Crea `app/web/test/auth.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { esci, sessioneValida, verifierEsfida } from '../src/auth.js';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('PKCE', () => {
  it('derives the challenge from the verifier, and not the other way round', async () => {
    const { verifier, challenge } = await verifierEsfida();
    expect(verifier).not.toBe(challenge);
    // base64url: no padding, no + or /
    expect(challenge).not.toMatch(/[+/=]/);
    const { challenge: again } = await verifierEsfida();
    expect(again).not.toBe(challenge);
  });
});

describe('sessioneValida', () => {
  it('is null when nothing was ever stored', () => {
    expect(sessioneValida()).toBeNull();
  });

  it('returns the session while it is still good', () => {
    localStorage.setItem('sessione', JSON.stringify({ idToken: 't', scade: 2_000 }));
    expect(sessioneValida(1_000)?.idToken).toBe('t');
  });

  it('is null once it has expired', () => {
    localStorage.setItem('sessione', JSON.stringify({ idToken: 't', scade: 1_000 }));
    expect(sessioneValida(2_000)).toBeNull();
  });

  it('counts a session about to expire as expired', () => {
    // A token that dies during the request in flight is worse than one that
    // was never sent: the call fails halfway through a save.
    localStorage.setItem('sessione', JSON.stringify({ idToken: 't', scade: 60_000 }));
    expect(sessioneValida(59_000)).toBeNull();
  });

  it('is null when what is stored is not a session at all', () => {
    localStorage.setItem('sessione', 'non json');
    expect(sessioneValida()).toBeNull();
  });

  it('forgets everything on the way out', () => {
    localStorage.setItem('sessione', JSON.stringify({ idToken: 't', scade: 9e12 }));
    esci();
    expect(sessioneValida()).toBeNull();
  });
});
```

- [ ] **Step 2: Esegui e verifica che falliscano**

Run: `cd app && npx vitest run --root web web/test/auth.test.ts`
Expected: FAIL — `../src/auth.js` non esiste.

- [ ] **Step 3: Scrivi `web/src/auth.ts`**

```ts
/** Getting in.
 *
 * Authorization code with PKCE against Cognito's managed login. No client
 * secret: one inside a JavaScript bundle is not a secret, and PKCE is what
 * replaces it — a random verifier stays in this tab, only its hash travels,
 * and the code that comes back is worthless without the verifier.
 */

const CHIAVE_SESSIONE = 'sessione';
const CHIAVE_VERIFIER = 'pkce';

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
  sessionStorage.removeItem(CHIAVE_VERIFIER);
}

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

export async function iniziaAccesso(): Promise<void> {
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

  const j = (await r.json()) as { id_token: string; expires_in: number };
  localStorage.setItem(
    CHIAVE_SESSIONE,
    JSON.stringify({ idToken: j.id_token, scade: Date.now() + j.expires_in * 1000 }),
  );
  sessionStorage.removeItem(CHIAVE_VERIFIER);
  // Take the code out of the address bar: it is single-use, but it has no
  // business staying in history or in a shared link.
  history.replaceState({}, '', location.origin + '/');
  return true;
}
```

- [ ] **Step 4: Allega il token in `web/src/api.ts`**

Aggiungi in cima l'import di `sessioneValida` e `esci`, e una funzione:

```ts
/** Every call carries the token. A 401 means the session died despite the
 *  margin — forget it and let the app send her back to the login rather than
 *  showing a failure she can do nothing about. */
function autorizzazione(): Record<string, string> {
  const s = sessioneValida();
  return s ? { authorization: `Bearer ${s.idToken}` } : {};
}
```

Aggiungila agli header sia in `request` sia in `readPhoto`, e in entrambi, su `r.status === 401`, chiama `esci()` prima di sollevare.

- [ ] **Step 5: Il gate in `App.tsx`**

`App` riceve una prop nuova `sessione: Sessione`, e non si occupa d'altro. Il gate sta in `main.tsx`, dove c'è già il montaggio:

```tsx
const avvia = async () => {
  await completaAccesso();
  const s = sessioneValida();
  if (!s) {
    await iniziaAccesso();
    return;
  }
  createRoot(radice).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
};
void avvia();
```

Niente si disegna prima che ci sia una sessione: una schermata a metà, con i dati che non arrivano perché l'API risponde 401, è peggio di un redirect.

- [ ] **Step 6: Config del pool per il build**

In `app/web/.env.production` (ricreato — era stato eliminato quando non serviva più):

```
# Ne' l'uno ne' l'altro e' un segreto: stanno nel bundle, e devono starci.
VITE_LOGIN_DOMAIN=https://turni-vanessa.auth.eu-south-1.amazoncognito.com
VITE_CLIENT_ID=
```

Il client id è l'output `IdClient` dello stack `VanessaAccesso` e va incollato **prima** di ricompilare. Sì, è di nuovo il passo che era stato tolto: qui non c'è modo di evitarlo, perché il browser deve conoscere il client id prima di poter chiedere un token a qualcuno.

- [ ] **Step 7: Aggiorna i test esistenti del frontend**

`web/test/app.test.tsx` monta `App` direttamente e non passa da `main.tsx`, quindi il gate non lo tocca. Verifica che sia così; se qualche test fallisce perché `api.ts` ora cerca una sessione, mettine una valida nel `localStorage` nel setup del test — non togliere l'header.

- [ ] **Step 8: Esegui tutto**

Run: `cd app && npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/web/src/auth.ts app/web/test/auth.test.ts app/web/src/api.ts app/web/src/App.tsx app/web/src/main.tsx app/web/test/app.test.tsx app/web/.env.production
git commit -m "feat: si entra col volto, e ogni chiamata porta il token"
```

---

### Task 4: la documentazione, e come si crea l'utente

**Files:**
- Modify: `app/README.md`
- Modify: `docs/superpowers/specs/2026-08-02-web-app-aws-design.md`

- [ ] **Step 1: Il README**

Sostituisci la sezione **Nessuna autenticazione** con una che dice cosa c'è adesso, e sii preciso su tre cose che altrimenti sorprendono:

- si entra con la passkey, e la verifica biometrica è obbligatoria;
- **una password esiste comunque** — Cognito non permette di toglierla — quindi il pavimento della sicurezza è la sua forza, non il volto: lunga, casuale, in un gestore di password;
- la sessione dura un giorno di proposito, ed è un Face ID la mattina.

E aggiungi la procedura per creare l'utente, che è a mano:

```bash
aws cognito-idp admin-create-user \
  --region eu-south-1 \
  --user-pool-id "$(aws cloudformation describe-stacks --stack-name VanessaAccesso \
      --query "Stacks[0].Outputs[?OutputKey=='IdPool'].OutputValue" --output text)" \
  --username vanessa@esempio.it \
  --user-attributes Name=email,Value=vanessa@esempio.it Name=email_verified,Value=true
```

Poi: primo accesso dal telefono con il codice via email, e da lì si registra la passkey. Ogni dispositivo nuovo rifà il giro.

- [ ] **Step 2: Lo spec che diceva il contrario**

`2026-08-02-web-app-aws-design.md` ha una sezione «Decisione deliberata: nessuna autenticazione» che adesso è falsa. Non cancellarla: era una decisione vera, presa con cognizione, e la sua storia vale. Mettici sopra un riquadro che dice che è stata superata, da quando e da quale spec, e lascia il resto.

- [ ] **Step 3: Commit**

```bash
git add app/README.md docs/superpowers/specs/2026-08-02-web-app-aws-design.md
git commit -m "docs: come si entra, e come si crea l'utente"
```

---

## Deploy, e cosa verificare

Ordine obbligato: **prima `VanessaAccesso`, poi il client id nel frontend, poi `VanessaApp`.** Il secondo stack ha bisogno degli output del primo, e il frontend ha bisogno del client id per compilare qualcosa che funzioni.

1. `cdk deploy VanessaAccesso` — leggi `IdPool`, `IdClient`, `DominioLogin`.
2. Incolla il client id in `web/.env.production`, committa.
3. `git push` — la pipeline distribuisce `VanessaApp` e il frontend.
4. Crea l'utente col comando qui sopra.
5. Dal telefono: apri l'app, dovresti finire su Cognito. Entra col codice via email, registra la passkey.
6. Chiudi e riapri: deve chiedere il volto e rientrare.

Da verificare col terminale, perché il browser da solo non lo dice:

```bash
# Senza token: deve rifiutare, non servire dati.
curl -s -o /dev/null -w '%{http_code}\n' https://vanessa.matteo.cool/api/config          # atteso 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://vanessa.matteo.cool/foto/leggi \
  -H 'content-type: application/json' -d '{}'                                            # atteso 401
```

Il secondo è quello che conta di più: se risponde 400 invece di 401, la verifica del token non sta girando prima della validazione del corpo, e una richiesta senza accesso può ancora consumare la quota del giorno.
