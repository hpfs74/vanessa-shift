# Due letture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the colleagues' roster back by reading the sheet twice: call 1 (her row, unchanged) and an automatic call 2 (all rows, no reasoning) whose copy of her row is checked against call 1 before the roster is kept.

**Architecture:** `core` gains the call-2 schema, its shape validator and the checksum (`rosterFromSecondRead`). `api` gains a second `Vision` and a `readRoster` handler. `infra` gains a `ReadRoster` Lambda behind a Function URL and a `/colleghe/*` CloudFront behaviour. `web` fires call 2 as soon as call 1 returns and fills the existing roster block.

**Tech Stack:** TypeScript monorepo (`app/core`, `app/api`, `app/web`, `app/infra`), Vitest, React, AWS CDK, Bedrock via `@anthropic-ai/bedrock-sdk`.

**Spec:** `docs/superpowers/specs/2026-09-20-due-letture-design.md`

## Global Constraints

- Call 1 (`createVision`, `readPhotoWith`, `/foto/*`) is not modified, except that `others` leaves `READING_SCHEMA`.
- Call 2: model `MODEL` (`eu.anthropic.claude-sonnet-4-6`), **no `thinking`, no `effort`**, `output_config.format` = the call-2 JSON schema only.
- `MAX_READINGS_PER_DAY` = **20** (ten sheets of two readings). Both handlers consume the same counter.
- Endpoint `/colleghe/leggi`, CloudFront behaviour `/colleghe/*` with `readTimeout` 60 s.
- `ReadRoster` Lambda: same entry file as `ReadPhoto`, handler `readRoster`, own log group (one month), `timeout` 120 s, `memorySize` 512, `reservedConcurrentExecutions` 2, `grantReadWriteData`, the same Bedrock `InvokeModel` policy as `ReadPhoto`.
- Every call-2 failure (504, `VisionFailed`, invalid shape, failed checksum, quota exhausted, network) shows the same single Italian line: **«Le colleghe non si sono lette questa volta. I tuoi turni non cambiano.»**
- Saving her shifts is never blocked or delayed by call 2.
- The image is re-sent by the browser; nothing stores it.
- User-facing copy in Italian; code comments in English, explaining why.

## Rulings made while planning (gaps in the spec)

- **`x` cells.** `normaliseCode('x')` returns `'X'`, not `''`. The model writes `x` for empty cells without reasoning (spec, *Decisione: le colleghe senza ragionamento*). `rosterFromSecondRead` maps a normalised `'X'` to `''` for every row before comparing and before storing. Cost if wrong: a real shift code `X` would vanish; no such code exists on the sheet.
- **Bedrock permission.** The spec's infra section omits it; `ReadRoster` cannot call the model without it. Same policy statement as `ReadPhoto`.
- **Call-2 `max_tokens` = 4000.** Measured output is ~1170 tokens with no reasoning, at ~150 tokens/s; 4000 caps the call near 27 s, inside the 60 s wall, and still covers a sheet three times as large. A truncation becomes `VisionFailed('truncated')` → the failure line.
- **Prompt.** The call-2 prompt is the one measured on 2026-11-16 (it lived in the deleted probe): the grid/alignment paragraph copied verbatim from call 1's `PROMPT`, then "read ALL rows… one `codes` list per person as long as the month… copy the code as written, also unknown ones (F, R, C, N1 and others)… empty, x or unreadable → empty string".
- **Shape validation lives in `core`** (`validateSecondRead`), so the handler and its tests use the same rule.

## Review Focus

- Call 2 returns after she pressed «ripeti con un altra foto» or picked a second photo: the stale roster must not attach to the new reading.
- She changes the month in the selector before call 2 returns: the roster arriving later must be reshaped to the selected month, as `setMonth` does for one already present.
- She saves before call 2 returns: her shifts save; the roster is not saved; when it arrives, pressing save again saves it.
- Call 2 says a different month/year than call 1, or a row name with different case/spacing than `foundName` ("VANESSA ", "Vanessa Rossi"): month mismatch → `null`; name matching uses `normaliseColleague` + lower-case against `foundName` then `ROW_NAME`.
- A `401` from `/colleghe/leggi`: must go through `sessioneRifiutata()` like `/foto/leggi`, not be swallowed as the generic failure line only.

---

### Task 1: `core` — call-2 schema, shape check and checksum

**Files:**
- Modify: `app/core/src/photo.ts` (`MAX_READINGS_PER_DAY` 10 → 20 with comment; remove `others` from `READING_SCHEMA` and the comment about it)
- Modify: `app/core/src/roster.ts` (new exports below)
- Test: `app/core/test/roster.test.ts`, `app/core/test/photo.test.ts`

**Interfaces:**
- Produces (exported from `@vanessa/core`):
  - `interface RawRow { readonly name: string; readonly row: number | null; readonly codes: readonly string[] }`
  - `interface SecondRead { readonly month: number; readonly year: number; readonly rows: readonly RawRow[] }`
  - `const SECOND_READ_SCHEMA: Record<string, unknown>` — `{ month: integer, year: integer, rows: [{ name: string, row: integer|null, codes: string[] }] }`, all required, `additionalProperties: false` at both levels.
  - `function validateSecondRead(v: unknown): SecondRead` — throws `InvalidReading` (from `photo.ts`) unless `month` is an integer 1–12, `year` an integer, `rows` an array; drops (does not throw on) individual rows whose `name` is not a string or `codes` is not an array of strings; coerces a non-integer `row` to `null`.
  - `function rosterFromSecondRead(reading: PhotoReading, second: SecondRead): MonthRoster | null`

- [ ] **Step 1: Write the failing tests** in `roster.test.ts`, `describe('rosterFromSecondRead')`. Build `reading` as an August 2026 `PhotoReading` with `foundName: 'Vanessa'` and a 31-day pattern; build `second` whose rows include her row (codes = her codes, `null` → `''`) and two colleagues.
  - matching row → `MonthRoster` with `year 2026, month 8`, `people.length === 2`, her name absent from `people`
  - one cell different in her row → `null`
  - her row shifted one column (`['', ...codes.slice(0, 30)]`) → `null`
  - her row written `'x'` where `reading` has `null` → not `null` (x is empty)
  - a colleague's `'x'` cells are stored as `''`
  - unknown codes survive: colleague codes `['F','N1','R',…]` appear unchanged in `people[i].codes`
  - `second.month !== reading.month` (or year) → `null`
  - no row matching `foundName` or `ROW_NAME` → `null`
  - her row found by `foundName` in a different form: `reading.foundName = 'ROSSI VANESSA'`, row name `'Rossi  Vanessa'` → not `null`, and that row is not in `people`
  - two rows match her name: the first is compared (first matches, second differs → roster; first differs → `null`)

  `describe('validateSecondRead')`: valid object round-trips; `month: 13` throws `InvalidReading`; `rows: 'x'` throws; a row `{ name: 3, codes: [] }` is dropped; `row: 2.5` becomes `null`.

  In `photo.test.ts`: `expect(MAX_READINGS_PER_DAY).toBe(20)`; `expect((READING_SCHEMA.properties as object)).not.toHaveProperty('others')`.

- [ ] **Step 2: Run, expect FAIL**
Run: `cd app && npx vitest run --root core`
Expected: FAIL — `rosterFromSecondRead`/`validateSecondRead`/`SECOND_READ_SCHEMA` not exported, quota still 10, `others` still in the schema.

- [ ] **Step 3: Implement.** `rosterFromSecondRead` in the spec's order: (1) month/year match else `null`; (2) find her row by `normaliseColleague(name).toLocaleLowerCase('it')` against `foundName` then `ROW_NAME`, first match wins, none → `null`; (3) compare day by day: `cleanCode(c) = normaliseCode(c) === 'X' ? '' : normaliseCode(c)` against `reading` day codes (`null` → `''`), any difference → `null`; (4) return `validateRoster({ others: rowsWithoutHerMatchedRow.map(r => ({ ...r, codes: r.codes.map(cleanCode) })) }, reading.year, reading.month, reading.foundName)`.

- [ ] **Step 4: Run, expect PASS**
Run: `cd app && npx vitest run --root core && npm run typecheck`
Expected: all core tests pass; typecheck clean.

- [ ] **Step 5: Commit** `feat(core): la seconda lettura, la sua forma e il checksum sulla riga di lei`

---

### Task 2: `api` — second Vision and `readRoster` handler

**Files:**
- Modify: `app/api/src/vision.ts` (add `ROSTER_PROMPT`, `ROSTER_MAX_TOKENS = 4000`, `createRosterVision`)
- Modify: `app/api/src/handlers.ts` (add `readRosterWith`, export `readRoster`)
- Test: `app/api/test/vision.test.ts`, `app/api/test/handlers.test.ts`

**Interfaces:**
- Consumes: `SECOND_READ_SCHEMA`, `validateSecondRead`, `SecondRead`, `InvalidReading`, `MAX_READINGS_PER_DAY` from Task 1.
- Produces:
  - `createRosterVision(client?: MessagesClient): Vision` — same failure handling as `createVision` (refusal, max_tokens, no-text, not-json → `VisionFailed`).
  - `readRosterWith(repo: Repo, vision: Vision, today?, signedIn?)` → handler responding `200 { month, year, rows }`.
  - `export const readRoster = (e) => readRosterWith(repoFromEnvironment(), createRosterVision())(e)`

- [ ] **Step 1: Write the failing tests.**
  - `vision.test.ts`: with a fake `MessagesClient` capturing the request, `createRosterVision` sends `model: MODEL`, `max_tokens: 4000`, **no `thinking` key**, `output_config` deep-equal to `{ format: { type: 'json_schema', schema: SECOND_READ_SCHEMA } }`, and a prompt containing `'TUTTE le righe'`; `stop_reason: 'max_tokens'` → rejects with `VisionFailed` reason `'truncated'`.
  - `handlers.test.ts`, `describe('readRoster')`, mirroring the `readPhoto` block's fakes:
    - signed-in check runs first: a rejecting `signedIn` → 401 and `consumePhotoQuota` never called
    - consumes the same counter: `consumePhotoQuota` called with `(today, 20)`
    - quota exhausted → 429
    - `VisionFailed` → 422
    - shape invalid (`{ month: 13 }`) → 422
    - other vision error → 502
    - valid → 200 with body `{ month, year, rows }` equal to `validateSecondRead(raw)`

- [ ] **Step 2: Run, expect FAIL** — `cd app && npx vitest run --root api` → new tests fail (not exported).

- [ ] **Step 3: Implement.** `readRosterWith` follows `readPhotoWith`'s order exactly (signed in → `requireImage` → quota → vision → validate), reusing its 429/502 messages; 422 uses a new constant `ROSTER_UNREADABLE = 'Le colleghe non si sono lette questa volta. I tuoi turni non cambiano.'`. It does **not** compute the checksum. `createRosterVision` shares the response-handling code with `createVision` via a private helper rather than duplicating it.

- [ ] **Step 4: Run, expect PASS** — `cd app && npx vitest run --root api && npm run typecheck`.

- [ ] **Step 5: Commit** `feat(api): la seconda lettura, senza ragionamento, dietro lo stesso contatore`

---

### Task 3: `infra` — `ReadRoster` Lambda and `/colleghe/*`

**Files:**
- Modify: `app/infra/lib/app-stack.ts`
- Test: `app/infra/test/stacks.test.ts`

**Interfaces:**
- Consumes: handler export `readRoster` (Task 2).
- Produces: `this.rosterUrl` (Function URL) and `CfnOutput 'RosterUrl'`, mirroring `photoUrl`/`PhotoUrl`.

- [ ] **Step 1: Write the failing tests** next to the existing `index.readPhoto` assertions (`stacks.test.ts:255`, `:307`, `:391`):
  - a Lambda with `Handler: 'index.readRoster'`, `Timeout: 120`, `MemorySize: 512`, `ReservedConcurrentExecutions: 2`
  - the distribution has a cache behaviour `PathPattern: '/colleghe/*'` whose origin has `OriginReadTimeout: 60`
  - the `ReadRoster` role has `bedrock:InvokeModel` and DynamoDB write actions; the read-only Lambdas still have no write actions (extend the existing least-privilege test's list rather than adding a new one)
  - extend the test that counts Lambdas by handler name with `readRoster`

- [ ] **Step 2: Run, expect FAIL** — `cd app && npx vitest run --root infra`.

- [ ] **Step 3: Implement** by mirroring `ReadPhoto` (construct ids `ReadRoster`, `ReadRosterLog`), the Bedrock statement (extract a small local helper so the two functions cannot drift), `addFunctionUrl({ authType: NONE })`, and the `/colleghe/*` behaviour identical to `/foto/*`. Comment why it is a separate function (spec, *L'infrastruttura*: reserved concurrency 2 per function keeps her fast path independent).

- [ ] **Step 4: Run, expect PASS** — `cd app && npx vitest run --root infra && npm run typecheck`.

- [ ] **Step 5: Commit** `feat(infra): ReadRoster e /colleghe/*, accanto alla lettura della foto`

---

### Task 4: `web` — fire call 2 and fill the roster block

**Files:**
- Modify: `app/web/src/api.ts` (`ROSTER_URL = '/colleghe/leggi'`, `readRoster(image): Promise<SecondRead>`; `PhotoRead` keeps its shape)
- Modify: `app/web/src/PhotoImport.tsx`, `app/web/src/BulkEntry.tsx`, `app/web/src/App.tsx` (new prop `onReadRoster: (image: string) => Promise<SecondRead>` passed App → BulkEntry → PhotoImport)
- Test: `app/web/test/photoImport.test.tsx`, `app/web/test/api.test.ts`

**Interfaces:**
- Consumes: `rosterFromSecondRead`, `reshapeRoster`, `SecondRead` from `@vanessa/core`.

- [ ] **Step 1: Write the failing tests.**
  - `api.test.ts`: `readRoster` POSTs `{ image }` to `/colleghe/leggi` with the auth header; a 401 calls the same path as `readPhoto` does (assert the same observable effect the existing `readPhoto` 401 test asserts); a non-ok response rejects.
  - `photoImport.test.tsx` (use the existing helpers for `onRead`):
    - after call 1 resolves, `onReadRoster` is called once with the same resized image, and «Leggo anche le colleghe…» is visible while it is pending
    - call 2 resolves with a matching `SecondRead` → «lette 2 persone» toggle appears; the waiting line is gone
    - call 2 resolves with her row shifted → the failure line «Le colleghe non si sono lette questa volta. I tuoi turni non cambiano.» and no toggle
    - call 2 rejects → same failure line
    - the grid is visible and saving works while call 2 is still pending; `onSaveRoster` is not called
    - call 2 resolves after a save → pressing save again calls `onSaveRoster` with the roster
    - month changed in the selector before call 2 resolves → `onSaveRoster` receives a roster with the selected month
    - «ripeti con un altra foto» pressed before call 2 resolves → the late result shows nothing
  - The roster from call 1 (`PhotoRead.roster`) is no longer used by `PhotoImport`: remove `setRoster(roster)` from `pick` (it is always empty now).

- [ ] **Step 2: Run, expect FAIL** — `cd app && npx vitest run --root web`.

- [ ] **Step 3: Implement.** In `pick`, after `setReading(...)`, start call 2 without awaiting it inside the `try`: keep a `useRef` attempt counter incremented by `pick` and by «ripeti»; when call 2 settles, ignore it unless the counter is unchanged; on success compute `rosterFromSecondRead(reading, second)` against **call 1's reading as returned** (not the edited grid), reshape to the currently selected month, then `setRoster` or set the failure state. Add a `rosterStatus: 'idle' | 'reading' | 'failed'` state alongside `roster`; the waiting/failure lines render where the roster block is. `save` is unchanged.

- [ ] **Step 4: Run, expect PASS** — `cd app && npm run typecheck && npm test`.

- [ ] **Step 5: Commit** `feat(web): la seconda lettura parte da sola e riempie il blocco delle colleghe`

### After the deploy (by hand)

1. Import the August screenshot: the grid appears at ~35 s, «Leggo anche le colleghe…» then «lette N persone» a few seconds later.
2. Import the July paper photo: either a roster or the failure line — never a stuck waiting line.
3. Lambda logs of `ReadRoster`: duration well under 60 s.
