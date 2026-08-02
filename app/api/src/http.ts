/** Input validation and response shapes.
 *
 * Malformed input must produce a 400 with a readable message, never a 500:
 * a 500 says "my fault" when the fault is the request's.
 *
 * The messages themselves stay in Italian — the app shows them to Vanessa.
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';

import type { IsoDate, PaySettings, ShiftCode } from '@vanessa/core';
import { daysBetween, isIsoDate, isShiftCode } from '@vanessa/core';

export const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? 'https://vanessa.matteo.cool';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': ALLOWED_ORIGIN,
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,PUT,OPTIONS',
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

export function optionalText(v: unknown, field: string, max = 200): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') throw new InvalidInput(`${field}: deve essere testo`);
  if (v.length > max) throw new InvalidInput(`${field}: massimo ${max} caratteri`);
  return v;
}

/** Wraps a handler: InvalidInput becomes 400, everything else a bare 500. */
export function handle(
  fn: () => Promise<APIGatewayProxyResultV2>,
): Promise<APIGatewayProxyResultV2> {
  return fn().catch((e: unknown) => {
    if (e instanceof InvalidInput) return failure(400, e.message);
    console.error('unhandled error', e);
    return failure(500, 'errore interno');
  });
}
