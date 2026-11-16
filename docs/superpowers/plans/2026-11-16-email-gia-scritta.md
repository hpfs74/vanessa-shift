# L'email già scritta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app remembers Vanessa's email and hands it to Cognito's sign-in page as `login_hint`, so she no longer types it.

**Architecture:** Three small changes in `web/src/auth.ts`: `completaAccesso()` saves the email read from the ID token, `esci()` leaves it alone, `iniziaAccesso()` adds it to the `/oauth2/authorize` link. The passkey registration needs no code: the Profilo link already exists.

**Tech Stack:** TypeScript, React web app, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-16-email-gia-scritta-design.md`

## Global Constraints

- localStorage key: `CHIAVE_EMAIL = 'email'`.
- Query parameter name: `login_hint`, value = the saved email, unencoded by hand (`URLSearchParams` encodes it).
- `esci()` must **not** remove the email: it runs when the day-long session ends, which is exactly when the email is needed next.
- The email is read with `claimsOf(idToken).email` from `web/src/claims.ts`; no new JWT parsing.
- Comments in the style of the surrounding file (English in `src`, explaining *why*).

## Review Focus

- ID token without an `email` claim (or unparseable): nothing is saved, and an email saved earlier is **not** overwritten with null/empty.
- Email with `+` or other characters (`vanessa+turni@x.it`): `login_hint` must round-trip exactly through `URL.searchParams`.
- A refused exchange (`?error=` back from Cognito): must not save or clear the email.
- The circuit breaker path (`sessioneRifiutata()` → `esci()`): the email survives it, like a normal `esci()`.
- Empty string stored under `email` (hand-edited storage): treated as no email, no `login_hint=` with an empty value.

---

### Task 1: Remember the email and pass it as `login_hint`

**Files:**
- Modify: `app/web/src/auth.ts` (constants near line 9; `esci()` ~84; `iniziaAccesso()` ~245; `completaAccesso()` ~363)
- Test: `app/web/test/auth.test.ts` (new `describe` blocks for `completaAccesso` email and `esci`)
- Test: `app/web/test/passkey.test.ts` (new `describe('iniziaAccesso')`, because it already has the `conConfig` re-import helper `iniziaAccesso` needs)

**Interfaces:**
- Consumes: `claimsOf(idToken: string | null | undefined): Claims` from `web/src/claims.ts`.
- Produces: no new exports. Behaviour only: `localStorage['email']` after a successful `completaAccesso()`; `login_hint` on the URL passed to `location.assign` by `iniziaAccesso()`.

- [ ] **Step 1: Write the failing tests**

In `auth.test.ts`, a helper that builds a fake ID token: `const idTokenCon = (payload: object) => 'h.' + btoa(JSON.stringify(payload)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') + '.s'` (check `claims.test.ts` first and reuse its helper if one exists).

```ts
describe('the remembered email', () => {
  const scambio = (id_token: string) =>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id_token, expires_in: 3600 }),
      { headers: { 'content-type': 'application/json' } })));

  it('is saved from the ID token after a successful sign-in', async () => {
    sessionStorage.setItem('pkce', 'v');
    scambio(idTokenCon({ email: 'vanessa+turni@esempio.it' }));
    await completaAccesso(new URL('https://esempio.test/?code=c'));
    expect(localStorage.getItem('email')).toBe('vanessa+turni@esempio.it');
  });

  it('is not overwritten by a token that carries no email', async () => {
    localStorage.setItem('email', 'vanessa@esempio.it');
    sessionStorage.setItem('pkce', 'v');
    scambio(idTokenCon({}));
    await completaAccesso(new URL('https://esempio.test/?code=c'));
    expect(localStorage.getItem('email')).toBe('vanessa@esempio.it');
  });

  it('is untouched by a refusal from Cognito', async () => {
    localStorage.setItem('email', 'vanessa@esempio.it');
    await completaAccesso(new URL('https://esempio.test/?error=access_denied')).catch(() => {});
    expect(localStorage.getItem('email')).toBe('vanessa@esempio.it');
  });

  it('survives esci(), because the morning after is when it is needed', () => {
    localStorage.setItem('email', 'vanessa@esempio.it');
    esci();
    expect(localStorage.getItem('email')).toBe('vanessa@esempio.it');
  });
});
```

Add one case inside the existing `describe('sessioneRifiutata')`, using its existing setup: after the second-cycle 401 that clears everything (the test at ~line 270), `expect(localStorage.getItem('email')).toBe(...)` with an email set beforehand.

In `passkey.test.ts`, stub `location` the way `avvio.test.tsx:44` does (`href`, `origin`, `assign: vi.fn()`), then:

```ts
describe('iniziaAccesso', () => {
  it('passes the remembered email as login_hint', async () => {
    localStorage.setItem('email', 'vanessa+turni@esempio.it');
    const { iniziaAccesso } = await conConfig(DOMINIO, CLIENT);
    await iniziaAccesso();
    const u = new URL(assign.mock.calls[0][0]);
    expect(u.pathname).toBe('/oauth2/authorize');
    expect(u.searchParams.get('login_hint')).toBe('vanessa+turni@esempio.it');
  });

  it('sends no login_hint when no email is remembered', async () => {
    const { iniziaAccesso } = await conConfig(DOMINIO, CLIENT);
    await iniziaAccesso();
    expect(new URL(assign.mock.calls[0][0]).searchParams.has('login_hint')).toBe(false);
  });

  it('sends no login_hint when the remembered email is empty', async () => {
    localStorage.setItem('email', '');
    const { iniziaAccesso } = await conConfig(DOMINIO, CLIENT);
    await iniziaAccesso();
    expect(new URL(assign.mock.calls[0][0]).searchParams.has('login_hint')).toBe(false);
  });
});
```

Clear `localStorage`/`sessionStorage` and unstub globals in `beforeEach`/`afterEach`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run --root web test/auth.test.ts test/passkey.test.ts`
Expected: the new "saved from the ID token" and "passes the remembered email" tests FAIL (no `email` key, no `login_hint`). The "not overwritten", "untouched" and "survives" cases may already pass — that is fine, they pin behaviour the change must not break.

- [ ] **Step 3: Implement in `app/web/src/auth.ts`**

- Add `const CHIAVE_EMAIL = 'email';` with the other keys, with a comment saying why `esci()` must leave it.
- In `completaAccesso()`, right after the session is stored: `const email = claimsOf(j.id_token).email; if (email) localStorage.setItem(CHIAVE_EMAIL, email);`
- In `iniziaAccesso()`, before `location.assign`: read `CHIAVE_EMAIL`; if it is a non-empty string, `u.searchParams.set('login_hint', email)`.
- `esci()` is unchanged; add one line to its comment stating it deliberately keeps `CHIAVE_EMAIL`.

- [ ] **Step 4: Run the whole web suite and typecheck**

Run: `cd app && npm run typecheck && npx vitest run --root web`
Expected: typecheck clean, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/web/src/auth.ts app/web/test/auth.test.ts app/web/test/passkey.test.ts
git commit -m "feat: l'app ricorda l'email e la passa a Cognito come login_hint"
```

### After the deploy (by hand, not a task)

1. Sign out, open the app: Cognito's page should show the email already filled in. If it doesn't, `login_hint` is not honoured by managed login with choice-based sign-in, and the spec's approach B becomes the next conversation.
2. On Vanessa's phone, right after signing in: Profilo → passkey link → register with Face ID.
3. Next sign-in on that phone: "Continua" should lead to Face ID, not to the email code.
