/** The only place that talks to the network. */

import type { PhotoReading, IsoDate, PaySettings, ShiftCode } from '@vanessa/core';

export interface RemoteShift {
  date: IsoDate;
  code: ShiftCode;
  hoursOverride?: number | null;
  originalCode?: ShiftCode | null;
  colleague?: string | null;
  swapKind?: string | null;
  notes?: string | null;
}

export const API_URL: string = import.meta.env.VITE_API_URL ?? '';

/** Photo reading lives on its own Function URL: API Gateway truncates the
 *  integration at 30 seconds, and a reading can take longer than that. */
export const PHOTO_URL: string = import.meta.env.VITE_PHOTO_URL ?? '';

/** The reading never left, or never came back whole. Every message on this
 *  path ends with a way out: the textarea is always one tap away. */
const UNREACHABLE =
  'Non sono riuscito a contattare il servizio. Controlla la connessione, oppure scrivi i codici a mano.';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!r.ok) {
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
    // The address is filled in after the stack is deployed. Left empty, `fetch`
    // would call the page itself and fail with something meaningless.
    if (!PHOTO_URL) {
      throw new Error(
        'La lettura da foto non è configurata su questa installazione. Scrivi i codici a mano.',
      );
    }

    let r: Response;
    try {
      r = await fetch(PHOTO_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image }),
      });
    } catch {
      // The reading takes up to two minutes, from a phone: a timeout or a lost
      // connection is not the rare case. `fetch` rejects with the browser's own
      // message — English, and with no way out.
      throw new Error(UNREACHABLE);
    }

    if (!r.ok) {
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
      const j = (await r.json()) as { reading: PhotoReading };
      return j.reading;
    } catch {
      // A body that stops halfway, or that isn't the JSON expected: from here
      // it's the same failure as never having arrived.
      throw new Error(UNREACHABLE);
    }
  },
};
