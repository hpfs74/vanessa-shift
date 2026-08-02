/** The only place that talks to the network. */

import type { PhotoReading, IsoDate, PaySettings, ShiftCode } from '@vanessa/core';

import { sessioneConfermata, sessioneRifiutata, sessioneValida } from './auth.js';

export interface RemoteShift {
  date: IsoDate;
  code: ShiftCode;
  hoursOverride?: number | null;
  originalCode?: ShiftCode | null;
  colleague?: string | null;
  swapKind?: string | null;
  notes?: string | null;
}

/** Same origin as the page: CloudFront forwards these two prefixes to the API
 *  and to the photo-reading function. Nothing to configure per environment,
 *  and nothing to paste in after a deploy — which is the step that used to be
 *  forgotten, leaving the feature mute. */
export const API_URL = '/api';
/** A sub-path, not a bare `/foto`: the CloudFront behaviour is `/foto/*`, and
 *  `*` matches zero or more characters *after* the literal `/foto/`, so a
 *  request for exactly `/foto` falls through to the default behaviour — the
 *  site bucket, which answers GET and HEAD only — and is refused at the edge.
 *  The Lambda behind it ignores the path, so the segment costs nothing and
 *  spares the distribution a third behaviour. */
export const PHOTO_URL = '/foto/leggi';

/** The reading never left, or never came back whole. Every message on this
 *  path ends with a way out: the textarea is always one tap away. */
const UNREACHABLE =
  'Non sono riuscito a contattare il servizio. Controlla la connessione, oppure scrivi i codici a mano.';

/** The distribution maps 403 and 404 to `index.html` with a 200, because the
 *  client router serves its own paths. Any refusal from either origin — a
 *  request that did not come through CloudFront, a signature that did not
 *  check out, a path nobody serves — therefore reaches the browser as the
 *  app's own HTML, with the status of a success. This is the only place that
 *  can tell that apart from an answer: without it `JSON.parse` speaks first,
 *  in English, and the screen reads `unexpected token '<'`. */
function requireJson(r: Response): void {
  if (!(r.headers.get('content-type') ?? '').includes('json')) throw new Error(UNREACHABLE);
}

/** Every call carries the token. A 401 means the ID token died despite the
 *  margin — most likely a device that slept through it, not a revoked
 *  session — so `sessioneRifiutata()` keeps the refresh token and reloads:
 *  main.tsx's gate tries a silent renewal before falling back to a login.
 *  Without the reload she is left staring at "richiesta fallita (401)" with
 *  every subsequent tap repeating it, because requests now go out with no
 *  token at all — every write here is single and repeatable, so nothing is
 *  lost by starting over. */
function autorizzazione(): Record<string, string> {
  const s = sessioneValida();
  return s ? { authorization: `Bearer ${s.idToken}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...autorizzazione(),
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) {
    if (r.status === 401) sessioneRifiutata();
    const text = await r.text().catch(() => '');
    // The fallback stays in Italian: it reaches the screen.
    let message = `richiesta fallita (${r.status})`;
    try {
      const j = JSON.parse(text) as { errore?: string };
      if (j.errore) message = j.errore;
    } catch {
      /* body was not JSON: keep the generic message */
    }
    throw new Error(message);
  }
  requireJson(r);
  // A call that succeeds is proof the session is good — but only past this
  // point: a CloudFront-rewritten refusal (a 403 or 404 turned into
  // `index.html` with a 200) is `r.ok` too, and would otherwise clear the
  // circuit breaker's marker on a response that was never a real answer.
  // Confirming before `requireJson` let two such refusals in a row reset the
  // counter between them, so a genuine second 401 right after was still read
  // as attempt one — reloading forever instead of tripping the breaker.
  sessioneConfermata();
  return (await r.json()) as T;
}

export interface Api {
  shifts(from: IsoDate, to: IsoDate): Promise<RemoteShift[]>;
  saveShift(shift: RemoteShift): Promise<void>;
  deleteShift(date: IsoDate): Promise<void>;
  saveShifts(shifts: readonly { date: IsoDate; code: ShiftCode }[]): Promise<void>;
  paySettings(): Promise<PaySettings>;
  savePaySettings(p: PaySettings): Promise<void>;
  readPhoto(image: string): Promise<PhotoReading>;
}

export const api: Api = {
  async shifts(from, to) {
    const r = await request<{ shifts: RemoteShift[] }>(
      `/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    return r.shifts;
  },
  async saveShift(shift) {
    await request(`/shifts/${encodeURIComponent(shift.date)}`, {
      method: 'PUT',
      body: JSON.stringify({
        code: shift.code,
        // Zero is a real override, so '' only stands in for "none".
        hoursOverride: shift.hoursOverride == null ? '' : shift.hoursOverride,
        originalCode: shift.originalCode ?? '',
        colleague: shift.colleague ?? '',
        swapKind: shift.swapKind ?? '',
        notes: shift.notes ?? '',
      }),
    });
  },
  async deleteShift(date) {
    await request(`/shifts/${encodeURIComponent(date)}`, {
      method: 'PUT',
      body: JSON.stringify({ code: '' }),
    });
  },
  async saveShifts(shifts) {
    await request('/shifts', { method: 'PUT', body: JSON.stringify({ shifts }) });
  },
  async paySettings() {
    const r = await request<{ pay: PaySettings }>('/config');
    return r.pay;
  },
  async savePaySettings(p) {
    await request('/config', { method: 'PUT', body: JSON.stringify(p) });
  },
  async readPhoto(image) {
    const body = JSON.stringify({ image });

    let r: Response;
    try {
      r = await fetch(PHOTO_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...autorizzazione() },
        body,
      });
    } catch {
      // The reading takes up to a minute, from a phone: a timeout or a lost
      // connection is not the rare case. `fetch` rejects with the browser's own
      // message — English, and with no way out.
      throw new Error(UNREACHABLE);
    }

    if (!r.ok) {
      if (r.status === 401) sessioneRifiutata();
      const text = await r.text().catch(() => '');
      let message = `lettura fallita (${r.status})`;
      try {
        const j = JSON.parse(text) as { errore?: string };
        if (j.errore) message = j.errore;
      } catch {
        /* the body wasn't JSON: the generic message stays */
      }
      throw new Error(message);
    }

    try {
      requireJson(r);
      // See the matching comment in `request()`: this has to run after
      // `requireJson`, not before, or a CloudFront-rewritten refusal (a 200
      // that isn't really an answer) would confirm a session that was never
      // actually checked.
      sessioneConfermata();
      const j = (await r.json()) as { reading: PhotoReading };
      return j.reading;
    } catch {
      // A body that stops halfway, or that isn't the JSON expected: from here
      // it's the same failure as never having arrived.
      throw new Error(UNREACHABLE);
    }
  },
};
