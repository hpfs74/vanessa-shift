/** Validazione dell'input e forma delle risposte.
 *
 * Un input malformato deve produrre 400 con un messaggio leggibile, mai 500:
 * un 500 dice "colpa mia" quando la colpa e' della richiesta.
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';

import type { Codice, IsoDate, Paga } from '@vanessa/core';
import { differenzaGiorni, isCodice, isIsoDate } from '@vanessa/core';

export const ORIGINE = process.env.ORIGINE_CONSENTITA ?? 'https://vanessa.matteo.cool';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': ORIGINE,
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,PUT,OPTIONS',
  'cache-control': 'no-store',
};

export function ok(body: unknown): APIGatewayProxyResultV2 {
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify(body) };
}

export function errore(statusCode: number, messaggio: string): APIGatewayProxyResultV2 {
  return { statusCode, headers: HEADERS, body: JSON.stringify({ errore: messaggio }) };
}

/** Errore che l'handler traduce in 400. Tutto il resto e' un 500 vero. */
export class InputNonValido extends Error {}

export function parseJson(body: string | undefined | null): Record<string, unknown> {
  if (!body) throw new InputNonValido('corpo della richiesta mancante');
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    throw new InputNonValido('corpo della richiesta non e JSON valido');
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new InputNonValido('il corpo deve essere un oggetto JSON');
  }
  return v as Record<string, unknown>;
}

export function esigiData(v: unknown, campo: string): IsoDate {
  if (!isIsoDate(v)) throw new InputNonValido(`${campo}: data non valida, attesa YYYY-MM-DD`);
  return v;
}

export function esigiCodice(v: unknown): Codice {
  if (!isCodice(v)) throw new InputNonValido('cod: codice turno sconosciuto');
  return v;
}

/** Il massimo e' un anno: senza limite una sola richiesta puo' leggere tutto. */
export const GIORNI_MAX = 366;

export function esigiIntervallo(da: unknown, a: unknown): { da: IsoDate; a: IsoDate } {
  const dal = esigiData(da, 'from');
  const al = esigiData(a, 'to');
  const giorni = differenzaGiorni(dal, al);
  if (giorni < 0) throw new InputNonValido('from deve precedere to');
  if (giorni > GIORNI_MAX) throw new InputNonValido(`intervallo troppo ampio, massimo ${GIORNI_MAX} giorni`);
  return { da: dal, a: al };
}

function percentuale(v: unknown, campo: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new InputNonValido(`${campo}: deve essere un numero`);
  }
  if (v < 0 || v > 1) throw new InputNonValido(`${campo}: deve stare fra 0 e 1`);
  return v;
}

export function esigiPaga(b: Record<string, unknown>): Paga {
  const tariffa = b.tariffaOraria;
  let tariffaOraria: number | null = null;
  if (tariffa !== null && tariffa !== undefined && tariffa !== '') {
    if (typeof tariffa !== 'number' || !Number.isFinite(tariffa)) {
      throw new InputNonValido('tariffaOraria: deve essere un numero');
    }
    if (tariffa < 0) throw new InputNonValido('tariffaOraria: non puo essere negativa');
    tariffaOraria = tariffa;
  }
  return {
    tariffaOraria,
    maggSabato: percentuale(b.maggSabato, 'maggSabato'),
    maggDomenica: percentuale(b.maggDomenica, 'maggDomenica'),
    maggFestivo: percentuale(b.maggFestivo, 'maggFestivo'),
    rateo13a: percentuale(b.rateo13a, 'rateo13a'),
    coeffNetto: percentuale(b.coeffNetto, 'coeffNetto'),
  };
}

export function testoOpzionale(v: unknown, campo: string, max = 200): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') throw new InputNonValido(`${campo}: deve essere testo`);
  if (v.length > max) throw new InputNonValido(`${campo}: massimo ${max} caratteri`);
  return v;
}

/** Avvolge un handler: InputNonValido diventa 400, il resto 500 senza dettagli. */
export function gestisci(
  fn: () => Promise<APIGatewayProxyResultV2>,
): Promise<APIGatewayProxyResultV2> {
  return fn().catch((e: unknown) => {
    if (e instanceof InputNonValido) return errore(400, e.message);
    console.error('errore non gestito', e);
    return errore(500, 'errore interno');
  });
}
