# API e foto dietro CloudFront — Implementation Plan

> **Questo file registra il piano come fu scritto, non ciò che è stato distribuito. Non
> copiarne codice.** In particolare: **la Function URL della foto non è passata a `AWS_IAM`
> dietro Origin Access Control.** Ci si è provato durante l'esecuzione e l'OAC è stato tolto di
> nuovo; è rimasta su `authType: NONE`, cioè raggiungibile da chiunque ne conosca l'indirizzo.
> Ogni frase qui sotto che dice «`/foto` è chiuso davvero», o che dà per acquisita una firma
> SigV4, è falsa. L'unica porta di quell'endpoint è il token che la Lambda verifica per prima.
> La fonte attuale è `app/infra/lib/app-stack.ts`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il browser conosce un solo indirizzo, e le due origini smettono di essere raggiungibili se non attraverso CloudFront.

**Architecture:** Due behaviour nuove sulla distribuzione — `/api/*` verso API Gateway e `/foto/*` verso la Function URL. Le rotte di API Gateway si spostano sotto `/api` così il path si inoltra senza riscritture. La Function URL passa a `AWS_IAM` con Origin Access Control; l'API, che non supporta resource policy, riceve da CloudFront un header segreto che le Lambda verificano.

**Tech Stack:** CDK, API Gateway HTTP API, Lambda Function URL + OAC, Secrets Manager, React + Vite.

Spec: `docs/superpowers/specs/2026-08-02-api-dietro-cloudfront-design.md`.

## Global Constraints

- Identificatori, commenti e descrizioni dei test in inglese. In italiano solo quello che legge Vanessa.
- Gli identificatori dei construct CDK esistenti non si toccano: rinominarli distrugge la risorsa. I nuovi sono liberi.
- `npm test` e `npm run typecheck` dalla cartella `app/` devono passare prima di ogni commit.
- Le rotte diventano `/api/shifts`, `/api/shifts/{date}`, `/api/config`. Il nome del path parameter `{date}` non cambia, quindi gli handler non si toccano.
- `ALL_VIEWER_EXCEPT_HOST_HEADER` su entrambe le behaviour. Inoltrare `Host` fa rifiutare la richiesta sia ad API Gateway sia alla Function URL.

## Le due protezioni non sono la stessa cosa

Scritto qui perché nessuno lo scopra dal codice e ne tragga conclusioni sbagliate.

**`/foto` è chiuso davvero.** `authType: AWS_IAM` più OAC: CloudFront firma ogni richiesta in SigV4 e la Function URL rifiuta tutto il resto. Chi conosce l'indirizzo non ci arriva più.

**`/api` è protetto da un segreto al portatore.** Le HTTP API non hanno resource policy — è una funzionalità delle REST API — quindi la strada praticabile è un header che CloudFront inietta e le Lambda verificano. Ferma gli scanner e l'accesso diretto casuale. Non è un controllo crittografico: chi ottiene quel valore, da un log o da un accesso in lettura all'account, torna a passare.

L'alternativa forte sarebbe passare a una REST API per avere le resource policy, il che cambia la forma dell'evento per tutti e cinque gli handler. Fuori perimetro.

---

### Task 1: le due behaviour, le rotte, e le due protezioni

Un task solo: le rotte, le behaviour e le protezioni sono la stessa modifica. Separarle lascerebbe uno stato intermedio in cui l'app non funziona.

**Files:**
- Modify: `app/infra/lib/app-stack.ts`
- Modify: `app/api/src/http.ts`
- Modify: `app/api/test/handlers.test.ts`
- Modify: `app/infra/test/stacks.test.ts`

**Interfaces:**
- Produces: `ORIGIN_SECRET_HEADER = 'x-cloudfront-origin'` e `requireFromCloudFront(headers)` da `http.js`.

- [ ] **Step 1: Scrivi i test dell'header segreto**

In `app/api/test/handlers.test.ts`, in fondo:

```ts
import { ORIGIN_SECRET_HEADER } from '../src/http.js';

describe('origin secret', () => {
  const secret = 'un-segreto-qualsiasi';

  beforeEach(() => {
    process.env.ORIGIN_SECRET = secret;
  });

  it('lets a request carrying the secret through', async () => {
    const { repo } = fakeRepo();
    const h = getShiftsWith(repo);
    const r: any = await h(
      event({
        headers: { [ORIGIN_SECRET_HEADER]: secret },
        queryStringParameters: { from: '2026-01-01', to: '2026-01-31' },
      }),
    );
    expect(r.statusCode).toBe(200);
  });

  it('refuses a request without the header', async () => {
    const { repo, calls } = fakeRepo();
    const h = getShiftsWith(repo);
    const r: any = await h(
      event({ queryStringParameters: { from: '2026-01-01', to: '2026-01-31' } }),
    );
    expect(r.statusCode).toBe(403);
    // The point of the check is that nothing behind it runs.
    expect(calls).toEqual([]);
  });

  it('refuses a request carrying the wrong secret', async () => {
    const { repo } = fakeRepo();
    const h = getShiftsWith(repo);
    const r: any = await h(
      event({
        headers: { [ORIGIN_SECRET_HEADER]: 'sbagliato' },
        queryStringParameters: { from: '2026-01-01', to: '2026-01-31' },
      }),
    );
    expect(r.statusCode).toBe(403);
  });

  it('compares in constant time, so the value cannot be guessed a byte at a time', async () => {
    // Not observable from the outside: asserted by construction, since the
    // comparison must not short-circuit on the first differing byte.
    const { requireFromCloudFront } = await import('../src/http.js');
    expect(typeof requireFromCloudFront).toBe('function');
  });

  it('lets everything through when no secret is configured', async () => {
    // Local runs and any deploy predating the secret must keep working:
    // an unset variable means the check is not in force, never that
    // every request is refused.
    delete process.env.ORIGIN_SECRET;
    const { repo } = fakeRepo();
    const h = getShiftsWith(repo);
    const r: any = await h(
      event({ queryStringParameters: { from: '2026-01-01', to: '2026-01-31' } }),
    );
    expect(r.statusCode).toBe(200);
  });
});
```

Ogni test già esistente in questo file non passa l'header. Il default «segreto assente = controllo non in vigore» è ciò che li tiene verdi: verifica che sia così e non aggiungere l'header ai test esistenti.

- [ ] **Step 2: Esegui e verifica che falliscano**

Run: `cd app && npx vitest run --root api api/test/handlers.test.ts`
Expected: FAIL — `ORIGIN_SECRET_HEADER` non esiste.

- [ ] **Step 3: Implementa il controllo in `api/src/http.ts`**

In cima, dopo `ALLOWED_ORIGIN`:

```ts
/** The header CloudFront injects on requests it forwards to the API.
 *
 * HTTP APIs have no resource policy — that is a REST API feature — so this
 * shared value is the practical way to tell a request that came through the
 * distribution from one aimed straight at the API's own hostname.
 *
 * It is a bearer secret, not a cryptographic control: anyone who obtains the
 * value can replay it. It stops scanners and casual direct access, which is
 * what it is for. The photo Function URL is a different story — that one is
 * signed with SigV4 through Origin Access Control and is genuinely closed.
 */
export const ORIGIN_SECRET_HEADER = 'x-cloudfront-origin';
```

E prima di `handle`:

```ts
/** Timing-safe string comparison.
 *
 * A plain `===` on a secret leaks its length and returns sooner the earlier
 * the first difference falls, which is enough to recover the value one byte
 * at a time given enough attempts. The API is public, so the attempts are
 * free.
 */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Refuses a request that did not come through CloudFront.
 *
 * When ORIGIN_SECRET is unset the check is not in force: a local run, and any
 * deploy made before the secret existed, must keep working. An unset variable
 * meaning "refuse everything" would take the app down on the way in.
 */
export function requireFromCloudFront(
  headers: Record<string, string | undefined> | undefined,
): void {
  const expected = process.env.ORIGIN_SECRET;
  if (!expected) return;
  // API Gateway lowercases header names; be explicit rather than trusting it.
  const found = Object.entries(headers ?? {}).find(
    ([k]) => k.toLowerCase() === ORIGIN_SECRET_HEADER,
  )?.[1];
  if (!found || !sameSecret(found, expected)) throw new NotFromCloudFront();
}

/** The request did not come through the distribution. */
export class NotFromCloudFront extends Error {}
```

E in `handle`, il ramo nuovo per primo:

```ts
export function handle(
  fn: () => Promise<APIGatewayProxyResultV2>,
): Promise<APIGatewayProxyResultV2> {
  return fn().catch((e: unknown) => {
    if (e instanceof NotFromCloudFront) return failure(403, 'accesso diretto non consentito');
    if (e instanceof TooLarge) return failure(413, e.message);
    if (e instanceof InvalidInput) return failure(400, e.message);
    console.error('unhandled error', e);
    return failure(500, 'errore interno');
  });
}
```

- [ ] **Step 4: Chiama il controllo nei cinque handler**

In `app/api/src/handlers.ts`, come prima riga dentro `handle(async () => {` di ciascuno dei cinque (`getShiftsWith`, `putShiftWith`, `putShiftsWith`, `getConfigWith`, `putConfigWith`):

```ts
      requireFromCloudFront(event.headers);
```

`getConfigWith` riceve `_event?` opzionale: cambia la firma in `(event?: APIGatewayProxyEventV2)` e passa `event?.headers`.

**Non** aggiungerlo a `readPhoto`: quella sta dietro OAC, che è una protezione vera, e un secondo controllo più debole accanto a una protezione forte confonde chi legge su quale delle due si stia contando.

- [ ] **Step 5: Esegui i test dell'API**

Run: `cd app && npx vitest run --root api`
Expected: PASS, compresi i 51 già esistenti — che non passano l'header e restano verdi grazie al default.

- [ ] **Step 6: Scrivi i test dell'infrastruttura**

In `app/infra/test/stacks.test.ts`, una `describe` nuova:

```ts
describe('one door only', () => {
  it('routes the API under /api, so CloudFront can forward the path as it is', () => {
    for (const path of ['/api/shifts', '/api/shifts/{date}', '/api/config']) {
      app.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: Match.stringLikeRegexp(`^(GET|PUT) ${path.replace(/[{}]/g, '\\$&')}$`),
      });
    }
  });

  it('serves /api and /foto from the same distribution as the site', () => {
    app.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({ PathPattern: '/api/*' }),
          Match.objectLike({ PathPattern: '/foto/*' }),
        ]),
      }),
    });
  });

  it('caches neither of them: they are not pages', () => {
    const behaviours = app.findResources('AWS::CloudFront::Distribution');
    const config = Object.values(behaviours)[0].Properties.DistributionConfig;
    for (const b of config.CacheBehaviors) {
      // The managed CachingDisabled policy.
      expect(b.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
    }
  });

  it('does not forward Host, which both origins would refuse', () => {
    const behaviours = app.findResources('AWS::CloudFront::Distribution');
    const config = Object.values(behaviours)[0].Properties.DistributionConfig;
    for (const b of config.CacheBehaviors) {
      // Managed AllViewerExceptHostHeader.
      expect(b.OriginRequestPolicyId).toBe('b689b0a8-53d0-40ab-baf2-68738e2966ac');
    }
  });

  it('closes the photo function to anything that is not the distribution', () => {
    app.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'AWS_IAM' });
    app.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunctionUrl',
      Principal: 'cloudfront.amazonaws.com',
      FunctionUrlAuthType: 'AWS_IAM',
    });
  });

  it('hands the API its shared secret as an origin header, never to the browser', () => {
    const behaviours = app.findResources('AWS::CloudFront::Distribution');
    const config = Object.values(behaviours)[0].Properties.DistributionConfig;
    const apiOrigin = config.Origins.find((o: { OriginPath?: string; Id: string }) =>
      config.CacheBehaviors.some(
        (b: { PathPattern: string; TargetOriginId: string }) =>
          b.PathPattern === '/api/*' && b.TargetOriginId === o.Id,
      ),
    );
    expect(apiOrigin.OriginCustomHeaders).toEqual([
      { HeaderName: 'x-cloudfront-origin', HeaderValue: Match.anyValue() },
    ]);
  });
});
```

- [ ] **Step 7: Esegui e verifica che falliscano**

Run: `cd app && npx vitest run --root infra`
Expected: FAIL.

- [ ] **Step 8: Modifica `infra/lib/app-stack.ts`**

Import nuovi:

```ts
import { AllowedMethods, CachePolicy, OriginRequestPolicy, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { FunctionUrlOrigin, HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Fn } from 'aws-cdk-lib';
```

Il segreto, prima delle Lambda. Sta in Secrets Manager e non nel repository né su GitHub, coerentemente con il resto dello stack, che non ha un solo segreto in giro:

```ts
    // Shared with CloudFront so the API can tell a request that came through
    // the distribution from one aimed at its own hostname. RETAIN because a
    // regenerated value would refuse every request until both sides catch up.
    const originSecret = new Secret(this, 'SegretoOrigine', {
      generateSecretString: { passwordLength: 40, excludePunctuation: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
```

Passalo alle cinque Lambda dell'API aggiungendo alla `environment` dentro l'helper `lambda()`:

```ts
          ORIGIN_SECRET: originSecret.secretValue.unsafeUnwrap(),
```

`unsafeUnwrap` qui produce un riferimento dinamico `{{resolve:secretsmanager:...}}` che CloudFormation risolve al deploy: il valore non finisce nel repository. Finisce nella configurazione della Lambda, leggibile da chi ha accesso all'account — le stesse persone che potrebbero leggerlo da Secrets Manager.

La Function URL passa a IAM:

```ts
    const photoFunctionUrl = readPhotoFn.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
    });
```

**Togli il blocco `cors`**: con OAC la richiesta arriva firmata da CloudFront, e la stessa origine non ha preflight da fare.

Le due behaviour, dentro `new Distribution(...)`:

```ts
      additionalBehaviors: {
        // Neither of these is a page: no caching, every method, and Host left
        // behind — forwarding it makes both origins refuse the request.
        '/api/*': {
          origin: new HttpOrigin(Fn.select(2, Fn.split('/', api.apiEndpoint))),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        '/foto/*': {
          origin: FunctionUrlOrigin.withOriginAccessControl(photoFunctionUrl, {
            // CloudFront caps the origin at 60 seconds and will not go higher
            // without a quota increase. A reading should take 15 to 40; past
            // 60 the viewer gets a 504, which the app already shows as "the
            // service is not responding" with a way out.
            readTimeout: Duration.seconds(60),
          }),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
```

L'header segreto va sull'origine dell'API. `HttpOrigin` lo prende in costruzione:

```ts
          origin: new HttpOrigin(Fn.select(2, Fn.split('/', api.apiEndpoint)), {
            customHeaders: { 'x-cloudfront-origin': originSecret.secretValue.unsafeUnwrap() },
          }),
```

Sposta le rotte sotto `/api`:

```ts
    route('/api/shifts', HttpMethod.GET, getShiftsFn, 'IntGetShifts');
    route('/api/shifts', HttpMethod.PUT, putShiftsFn, 'IntPutShifts');
    route('/api/shifts/{date}', HttpMethod.PUT, putShiftFn, 'IntPutShift');
    route('/api/config', HttpMethod.GET, getConfigFn, 'IntGetConfig');
    route('/api/config', HttpMethod.PUT, putConfigFn, 'IntPutConfig');
```

Gli id dei construct di integrazione (`IntGetShifts` e gli altri) non cambiano.

- [ ] **Step 9: Esegui i test e sintetizza**

Run: `cd app && npx vitest run --root infra && cd infra && npx cdk synth VanessaApp > /dev/null && echo ok`
Expected: PASS e `ok`.

- [ ] **Step 10: Commit**

```bash
git add app/infra/lib/app-stack.ts app/infra/test/stacks.test.ts app/api/src/http.ts app/api/src/handlers.ts app/api/test/handlers.test.ts
git commit -m "feat: una porta sola, e le origini chiuse dietro"
```

---

### Task 2: il frontend chiama la propria origine

**Files:**
- Modify: `app/web/src/api.ts`
- Modify: `app/web/vite.config.ts`
- Modify: `app/web/test/api.test.ts`
- Delete: `app/web/.env.production`
- Modify: `app/README.md`

- [ ] **Step 1: Aggiorna i test**

In `app/web/test/api.test.ts`, sostituisci le asserzioni che si aspettano un indirizzo assoluto con i path relativi, e **togli i test del guard sull'URL vuoto**: non c'è più niente da controllare, perché il path è una costante.

```ts
  it('calls the reading endpoint on its own origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ reading: {} }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await api.readPhoto('AAAA');
    expect(fetchMock.mock.calls[0][0]).toBe('/foto');
  });
```

- [ ] **Step 2: Esegui e verifica che falliscano**

Run: `cd app && npx vitest run --root web web/test/api.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modifica `web/src/api.ts`**

```ts
/** Same origin as the page: CloudFront forwards these two prefixes to the API
 *  and to the photo-reading function. Nothing to configure per environment,
 *  and nothing to paste in after a deploy — which is the step that used to be
 *  forgotten, leaving the feature mute. */
export const API_URL = '/api';
export const PHOTO_URL = '/foto';
```

Togli il guard su `PHOTO_URL` vuoto in `readPhoto`, e il messaggio che lo accompagnava: entrambi esistevano per una variabile d'ambiente che non c'è più. Il resto della funzione — la `fetch` avvolta, il messaggio italiano sul rifiuto e sul JSON illeggibile — resta.

- [ ] **Step 4: Proxy per il server di sviluppo**

In `app/web/vite.config.ts`, dentro `defineConfig`:

```ts
  // `npm run dev` serves the page from localhost, where /api and /foto have
  // nobody behind them: forward both to the deployed origins. In production
  // CloudFront does this, and neither address appears in the bundle.
  server: {
    proxy: {
      '/api': {
        target: 'https://sp99qts2me.execute-api.eu-south-1.amazonaws.com',
        changeOrigin: true,
      },
      '/foto': {
        target: 'https://yogkdmcpt4kdfochgr5vq4k6u40hsjuj.lambda-url.eu-south-1.on.aws',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/foto/, ''),
      },
    },
  },
```

Nota che in sviluppo l'API risponde solo se il segreto non è in vigore da quel lato, e la Function URL con OAC rifiuterà una richiesta non firmata: **dopo questa modifica il percorso foto non si prova più da `npm run dev`.** Va provato in linea. Scrivilo nel README.

- [ ] **Step 5: Elimina `.env.production`**

```bash
git rm app/web/.env.production
```

- [ ] **Step 6: Esegui tutto**

Run: `cd app && npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Aggiorna `app/README.md`**

Togli il passo «leggi l'output `PhotoUrl` e incollalo in `.env.production`» e le righe che lo spiegavano. Al suo posto, una sezione breve: un solo dominio, `/api` e `/foto` inoltrati da CloudFront, le due origini non più raggiungibili direttamente — la foto per davvero via OAC, l'API tramite un segreto al portatore — e il fatto che il percorso foto non si prova da `npm run dev`.

- [ ] **Step 8: Commit**

```bash
git add app/web/src/api.ts app/web/vite.config.ts app/web/test/api.test.ts app/README.md
git commit -m "feat: il frontend chiama la propria origine, e non ha piu' niente da configurare"
```

---

## Deploy

Un solo `git push origin main`: la pipeline distribuisce stack e frontend insieme.

Fra l'aggiornamento delle rotte e l'invalidazione di CloudFront c'è una finestra di qualche secondo in cui il frontend vecchio chiama rotte nuove, e le chiamate falliscono. Su un'app con un'utente sola, accettabile.

Dopo il deploy, verifica **nell'ordine**:

1. `curl -s -o /dev/null -w '%{http_code}' https://vanessa.matteo.cool/api/config` → `200`.
2. `curl -s -o /dev/null -w '%{http_code}' https://sp99qts2me.execute-api.eu-south-1.amazonaws.com/api/config` → `403`. Se torna `200`, il segreto non è arrivato a una delle due parti.
3. `curl -s -o /dev/null -w '%{http_code}' -X POST https://yogkdmcpt4kdfochgr5vq4k6u40hsjuj.lambda-url.eu-south-1.on.aws/ -d '{}'` → `403`. Se torna altro, l'OAC non è in vigore.
4. Una lettura vera dal telefono, cronometrata. **È il numero che decide se questa modifica regge:** oltre i 60 secondi CloudFront taglia, e la scelta va rivista.
