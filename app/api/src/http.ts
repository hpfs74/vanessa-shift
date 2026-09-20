/** Input validation and response shapes.
 *
 * Malformed input must produce a 400 with a readable message, never a 500:
 * a 500 says "my fault" when the fault is the request's.
 *
 * The messages themselves stay in Italian — the app shows them to Vanessa.
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';

import type { ContractKind, IsoDate, PaySettings, Profile, RosterPerson, ShiftCode } from '@vanessa/core';
import {
  MAX_DAY_HOURS,
  MAX_WEEKLY_HOURS,
  daysBetween,
  isContractKind,
  isIsoDate,
  isShiftCode,
  isSwapKind,
  isValidHours,
  normaliseCode,
  normaliseColleague,
} from '@vanessa/core';

import { NotSignedIn } from './token.js';

export const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? 'https://vanessa.matteo.cool';

/** The header CloudFront injects on requests it forwards to the API.
 *
 * HTTP APIs have no resource policy — that is a REST API feature — so this
 * shared value is the practical way to tell a request that came through the
 * distribution from one aimed straight at the API's own hostname.
 *
 * It is a bearer secret, not a cryptographic control: anyone who obtains the
 * value can replay it. It stops scanners and casual direct access, which is
 * what it is for. The photo Function URL is a different story, and not a
 * reassuring one: `AuthType: NONE`, no Origin Access Control, no shared
 * header — SigV4 through OAC was tried and taken back out (see the comment
 * in app-stack.ts) — so that URL is reachable by anyone who learns it. The
 * token check in token.ts is the only thing standing in front of the quota
 * and Bedrock there, not a second layer behind one that was already closed.
 */
export const ORIGIN_SECRET_HEADER = 'x-cloudfront-origin';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': ALLOWED_ORIGIN,
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
  'cache-control': 'no-store',
};

export function ok(body: unknown): APIGatewayProxyResultV2 {
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify(body) };
}

export function failure(statusCode: number, message: string): APIGatewayProxyResultV2 {
  return { statusCode, headers: HEADERS, body: JSON.stringify({ errore: message }) };
}

/** An error the handler turns into a 400. Anything else is a real 500. */
export class InvalidInput extends Error {}

export function parseJson(body: string | undefined | null): Record<string, unknown> {
  if (!body) throw new InvalidInput('corpo della richiesta mancante');
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    throw new InvalidInput('corpo della richiesta non e JSON valido');
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new InvalidInput('il corpo deve essere un oggetto JSON');
  }
  return v as Record<string, unknown>;
}

export function requireDate(v: unknown, field: string): IsoDate {
  if (!isIsoDate(v)) throw new InvalidInput(`${field}: data non valida, attesa YYYY-MM-DD`);
  return v;
}

export function requireShiftCode(v: unknown): ShiftCode {
  if (!isShiftCode(v)) throw new InvalidInput('cod: codice turno sconosciuto');
  return v;
}

/** One year at most: without a cap a single request could read everything. */
export const MAX_RANGE_DAYS = 366;

export function requireRange(from: unknown, to: unknown): { from: IsoDate; to: IsoDate } {
  const start = requireDate(from, 'from');
  const end = requireDate(to, 'to');
  const days = daysBetween(start, end);
  if (days < 0) throw new InvalidInput('from deve precedere to');
  if (days > MAX_RANGE_DAYS) {
    throw new InvalidInput(`intervallo troppo ampio, massimo ${MAX_RANGE_DAYS} giorni`);
  }
  return { from: start, to: end };
}

function percentage(v: unknown, field: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new InvalidInput(`${field}: deve essere un numero`);
  }
  if (v < 0 || v > 1) throw new InvalidInput(`${field}: deve stare fra 0 e 1`);
  return v;
}

export function requirePaySettings(b: Record<string, unknown>): PaySettings {
  const rate = b.hourlyRate;
  let hourlyRate: number | null = null;
  if (rate !== null && rate !== undefined && rate !== '') {
    if (typeof rate !== 'number' || !Number.isFinite(rate)) {
      throw new InvalidInput('hourlyRate: deve essere un numero');
    }
    if (rate < 0) throw new InvalidInput('hourlyRate: non puo essere negativa');
    hourlyRate = rate;
  }
  return {
    hourlyRate,
    saturdayPremium: percentage(b.saturdayPremium, 'saturdayPremium'),
    sundayPremium: percentage(b.sundayPremium, 'sundayPremium'),
    holidayPremium: percentage(b.holidayPremium, 'holidayPremium'),
    thirteenthAccrual: percentage(b.thirteenthAccrual, 'thirteenthAccrual'),
    netRatio: percentage(b.netRatio, 'netRatio'),
  };
}

export function requireHoursOverride(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (!isValidHours(v)) {
    throw new InvalidInput(`hoursOverride: ore non valide, attese fra 0 e ${MAX_DAY_HOURS}`);
  }
  return v;
}

export function requireSwapKind(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (!isSwapKind(v)) throw new InvalidInput('swapKind: tipo di scambio sconosciuto');
  return v;
}

/** A whole year at most: the bulk screen writes one month at a time. */
export const MAX_BULK = 366;

export function requireShiftList(b: Record<string, unknown>): {
  date: IsoDate;
  code: ShiftCode;
}[] {
  const raw = b.shifts;
  if (!Array.isArray(raw)) throw new InvalidInput('shifts: atteso un elenco');
  if (raw.length === 0) throw new InvalidInput('shifts: elenco vuoto');
  if (raw.length > MAX_BULK) {
    throw new InvalidInput(`shifts: troppi giorni, massimo ${MAX_BULK}`);
  }
  const seen = new Set<string>();
  return raw.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new InvalidInput(`shifts[${i}]: atteso un oggetto`);
    }
    const e = entry as Record<string, unknown>;
    const date = requireDate(e.date, `shifts[${i}].date`);
    // The same day twice would make the result depend on write order.
    if (seen.has(date)) throw new InvalidInput(`shifts: ${date} compare due volte`);
    seen.add(date);
    if (!isShiftCode(e.code)) {
      throw new InvalidInput(`shifts[${i}].code: codice turno sconosciuto`);
    }
    return { date, code: e.code };
  });
}

export function optionalText(v: unknown, field: string, max = 200): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') throw new InvalidInput(`${field}: deve essere testo`);
  if (v.length > max) throw new InvalidInput(`${field}: massimo ${max} caratteri`);
  return v;
}

export function requireObject(v: unknown, field: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new InvalidInput(`${field}: deve essere un oggetto`);
  }
  return v as Record<string, unknown>;
}

export function requireYearMonth(
  p: Record<string, string | undefined> | undefined,
): { year: number; month: number } {
  const year = Number(p?.year);
  const month = Number(p?.month);
  // Number(undefined) is NaN and Number('') is 0: both fail this.
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new InvalidInput('year: anno non valido');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new InvalidInput('month: mese fuori da 1-12');
  }
  return { year, month };
}

/** A ward is not this big. The cap is what keeps one item inside DynamoDB's
 *  400 KB, and a malformed client from writing a book. */
export const MAX_ROSTER_PEOPLE = 60;

/** Strict, unlike `validateRoster`. That one judges what a model said it read
 *  from a photograph; this one judges a body our own client has already
 *  validated, where anything malformed is a bug worth hearing about. */
export function requireRosterPeople(
  b: Record<string, unknown>,
  days: number,
): RosterPerson[] {
  const raw = b.people;
  if (!Array.isArray(raw)) throw new InvalidInput('people: atteso un elenco');
  if (raw.length > MAX_ROSTER_PEOPLE) {
    throw new InvalidInput(`people: troppe persone, massimo ${MAX_ROSTER_PEOPLE}`);
  }
  return raw.map((v, i) => {
    const p = requireObject(v, `people[${i}]`);
    const text = optionalText(p.name, `people[${i}].name`, 80);
    // The photo path runs every name through `normaliseColleague` (roster.ts's
    // `personOf`); this one must match, or the same field holds a trimmed name
    // when it came from a photo and a raw one when it came from this form.
    const name = text ? normaliseColleague(text) : '';
    if (!name) throw new InvalidInput(`people[${i}].name: atteso un nome`);
    if (!Array.isArray(p.codes) || p.codes.length !== days) {
      throw new InvalidInput(`people[${i}].codes: attesi ${days} giorni`);
    }
    return {
      name,
      row: typeof p.row === 'number' && Number.isInteger(p.row) ? p.row : null,
      codes: p.codes.map(normaliseCode),
    };
  });
}

export function requireWeeklyHours(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new InvalidInput('weeklyHours: deve essere un numero');
  }
  if (v < 0 || v > MAX_WEEKLY_HOURS) {
    throw new InvalidInput(`weeklyHours: attese fra 0 e ${MAX_WEEKLY_HOURS}`);
  }
  return v;
}

/** Every field is optional: the profile is filled in over time, from papers
 *  that are not all in the same drawer. Two fields are not free text, and
 *  `optionalText` alone would let them through wrong. */
export function requireProfile(b: Record<string, unknown>): Profile {
  let contractKind: ContractKind | null = null;
  const kind = b.contractKind;
  if (kind !== null && kind !== undefined && kind !== '') {
    if (!isContractKind(kind)) {
      throw new InvalidInput('contractKind: tipo di contratto sconosciuto');
    }
    contractKind = kind;
  }

  const hired = b.hiredOn;
  return {
    firstName: optionalText(b.firstName, 'firstName', 100),
    lastName: optionalText(b.lastName, 'lastName', 100),
    employer: optionalText(b.employer, 'employer', 200),
    hiredOn: hired === null || hired === undefined || hired === ''
      ? null
      : requireDate(hired, 'hiredOn'),
    contractKind,
    ccnlLevel: optionalText(b.ccnlLevel, 'ccnlLevel', 20),
    jobTitle: optionalText(b.jobTitle, 'jobTitle', 100),
    weeklyHours: requireWeeklyHours(b.weeklyHours),
    workplace: optionalText(b.workplace, 'workplace', 200),
    ward: optionalText(b.ward, 'ward', 200),
  };
}

/** Two megabytes. A properly resized image weighs less than one: past this
 *  threshold there's nothing to read, only money to spend. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** The body is too large: 413, and the request stops before it costs anything. */
export class TooLarge extends Error {}

export function requireImage(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new InvalidInput('image: attesa l immagine in base64');
  }
  // The base64 length is an over-estimate of the bytes: that's fine, the
  // check is meant to stop the huge, not to measure the exact.
  if (v.length > MAX_BODY_BYTES) throw new TooLarge('image: immagine troppo grande');
  return v;
}

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

/** 401, not 403.
 *
 * The distribution maps 403 and 404 onto `index.html` with a 200, because the
 * client router serves its own paths. A 403 from here would therefore reach
 * the browser as `200 text/html`, which the frontend reads as a success and
 * then fails to parse — «unexpected token '<'» instead of something the app
 * can name. CloudFront does not rewrite 401, so the collision does not arise.
 *
 * It is also the more accurate of the two: the request carried no credential,
 * rather than being refused a resource it was identified for.
 */
const NO_CREDENTIAL = 401;

/** Wraps a handler: InvalidInput becomes 400, everything else a bare 500. */
export function handle(
  fn: () => Promise<APIGatewayProxyResultV2>,
): Promise<APIGatewayProxyResultV2> {
  return fn().catch((e: unknown) => {
    if (e instanceof NotSignedIn) return failure(NO_CREDENTIAL, 'accesso non effettuato');
    if (e instanceof NotFromCloudFront) {
      return failure(NO_CREDENTIAL, 'credenziale di origine mancante o non valida');
    }
    if (e instanceof TooLarge) return failure(413, e.message);
    if (e instanceof InvalidInput) return failure(400, e.message);
    console.error('unhandled error', e);
    return failure(500, 'errore interno');
  });
}
