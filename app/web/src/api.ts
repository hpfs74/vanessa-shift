/** Il solo punto che parla con la rete. */

import type { Codice, IsoDate, Paga } from '@vanessa/core';

export interface TurnoRemoto {
  data: IsoDate;
  cod: Codice;
  codOrig?: Codice | null;
  collega?: string | null;
  tipoScambio?: string | null;
  note?: string | null;
}

export const URL_API: string = import.meta.env.VITE_URL_API ?? '';

async function chiedi<T>(percorso: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${URL_API}${percorso}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!r.ok) {
    const testo = await r.text().catch(() => '');
    let messaggio = `richiesta fallita (${r.status})`;
    try {
      const j = JSON.parse(testo) as { errore?: string };
      if (j.errore) messaggio = j.errore;
    } catch {
      /* il corpo non era JSON: tengo il messaggio generico */
    }
    throw new Error(messaggio);
  }
  return (await r.json()) as T;
}

export interface Api {
  turni(da: IsoDate, a: IsoDate): Promise<TurnoRemoto[]>;
  salvaTurno(data: IsoDate, cod: Codice | null): Promise<void>;
  paga(): Promise<Paga>;
  salvaPaga(p: Paga): Promise<void>;
}

export const api: Api = {
  async turni(da, a) {
    const r = await chiedi<{ turni: TurnoRemoto[] }>(
      `/shifts?from=${encodeURIComponent(da)}&to=${encodeURIComponent(a)}`,
    );
    return r.turni;
  },
  async salvaTurno(data, cod) {
    await chiedi(`/shifts/${encodeURIComponent(data)}`, {
      method: 'PUT',
      body: JSON.stringify({ cod: cod ?? '' }),
    });
  },
  async paga() {
    const r = await chiedi<{ paga: Paga }>('/config');
    return r.paga;
  },
  async salvaPaga(p) {
    await chiedi('/config', { method: 'PUT', body: JSON.stringify(p) });
  },
};
