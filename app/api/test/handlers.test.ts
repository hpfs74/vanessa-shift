import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it } from 'vitest';

import { PAGA_VUOTA } from '@vanessa/core';

import { getConfigCon, getShiftsCon, putConfigCon, putShiftCon } from '../src/handlers.js';
import type { Repo, Turno } from '../src/repo.js';

/** Repo in memoria: i test non toccano la rete. */
function repoFinto() {
  const turni = new Map<string, Turno>();
  let paga = PAGA_VUOTA;
  const chiamate: string[] = [];

  const repo: Repo = {
    async turniTra(da, a) {
      chiamate.push(`turniTra(${da},${a})`);
      return [...turni.values()]
        .filter((t) => t.data >= da && t.data <= a)
        .sort((x, y) => (x.data < y.data ? -1 : 1));
    },
    async salvaTurno(t) {
      chiamate.push(`salvaTurno(${t.data})`);
      turni.set(t.data, t);
    },
    async cancellaTurno(d) {
      chiamate.push(`cancellaTurno(${d})`);
      turni.delete(d);
    },
    async leggiPaga() {
      chiamate.push('leggiPaga');
      return paga;
    },
    async salvaPaga(p) {
      chiamate.push('salvaPaga');
      paga = p;
    },
  };
  return { repo, turni, chiamate, paga: () => paga };
}

function evento(p: Partial<APIGatewayProxyEventV2>): APIGatewayProxyEventV2 {
  return p as APIGatewayProxyEventV2;
}

function corpo(r: { body?: unknown }): any {
  return JSON.parse(String(r.body));
}

let f: ReturnType<typeof repoFinto>;
beforeEach(() => {
  f = repoFinto();
});

describe('GET /shifts', () => {
  it('restituisce i turni nellintervallo', async () => {
    await f.repo.salvaTurno({ data: '2026-01-05', cod: 'M' });
    await f.repo.salvaTurno({ data: '2026-02-10', cod: 'P' });

    const r: any = await getShiftsCon(f.repo)(
      evento({ queryStringParameters: { from: '2026-01-01', to: '2026-01-31' } }),
    );

    expect(r.statusCode).toBe(200);
    expect(corpo(r).turni).toHaveLength(1);
    expect(corpo(r).turni[0]).toMatchObject({ data: '2026-01-05', cod: 'M' });
  });

  it('un intervallo vuoto non e un errore', async () => {
    const r: any = await getShiftsCon(f.repo)(
      evento({ queryStringParameters: { from: '2026-01-01', to: '2026-01-31' } }),
    );
    expect(r.statusCode).toBe(200);
    expect(corpo(r).turni).toEqual([]);
  });

  it('rifiuta parametri mancanti o malformati con 400', async () => {
    for (const q of [
      undefined,
      {},
      { from: '2026-01-01' },
      { from: '01/01/2026', to: '2026-01-31' },
      { from: '2026-02-30', to: '2026-03-01' },
      { from: '2026-13-01', to: '2026-13-02' },
    ]) {
      const r: any = await getShiftsCon(f.repo)(evento({ queryStringParameters: q as any }));
      expect(r.statusCode, JSON.stringify(q)).toBe(400);
      expect(corpo(r).errore).toBeTruthy();
    }
  });

  it('rifiuta un intervallo rovesciato', async () => {
    const r: any = await getShiftsCon(f.repo)(
      evento({ queryStringParameters: { from: '2026-03-01', to: '2026-01-01' } }),
    );
    expect(r.statusCode).toBe(400);
    expect(corpo(r).errore).toMatch(/precedere/);
  });

  it('rifiuta un intervallo piu lungo di un anno', async () => {
    const r: any = await getShiftsCon(f.repo)(
      evento({ queryStringParameters: { from: '2026-01-01', to: '2027-06-01' } }),
    );
    expect(r.statusCode).toBe(400);
    expect(corpo(r).errore).toMatch(/troppo ampio/);
  });
});

describe('PUT /shifts/{date}', () => {
  it('salva un turno', async () => {
    const r: any = await putShiftCon(f.repo)(
      evento({ pathParameters: { date: '2026-01-05' }, body: JSON.stringify({ cod: 'M1' }) }),
    );
    expect(r.statusCode).toBe(200);
    expect(f.turni.get('2026-01-05')).toMatchObject({ cod: 'M1' });
  });

  it('salva i campi dello scambio', async () => {
    await putShiftCon(f.repo)(
      evento({
        pathParameters: { date: '2026-01-05' },
        body: JSON.stringify({
          cod: 'P',
          codOrig: 'M',
          collega: 'Giulia',
          tipoScambio: 'Ho coperto',
          note: 'cambio chiesto il giorno prima',
        }),
      }),
    );
    expect(f.turni.get('2026-01-05')).toMatchObject({
      cod: 'P',
      codOrig: 'M',
      collega: 'Giulia',
      tipoScambio: 'Ho coperto',
    });
  });

  it('un codice vuoto cancella il giorno invece di salvare un item vuoto', async () => {
    await f.repo.salvaTurno({ data: '2026-01-05', cod: 'M' });
    const r: any = await putShiftCon(f.repo)(
      evento({ pathParameters: { date: '2026-01-05' }, body: JSON.stringify({ cod: '' }) }),
    );
    expect(r.statusCode).toBe(200);
    expect(corpo(r).cancellato).toBe(true);
    expect(f.turni.has('2026-01-05')).toBe(false);
  });

  it('cancellare un giorno che non ce non e un errore', async () => {
    const r: any = await putShiftCon(f.repo)(
      evento({ pathParameters: { date: '2026-07-04' }, body: JSON.stringify({ cod: null }) }),
    );
    expect(r.statusCode).toBe(200);
  });

  it('rifiuta un codice sconosciuto', async () => {
    const r: any = await putShiftCon(f.repo)(
      evento({ pathParameters: { date: '2026-01-05' }, body: JSON.stringify({ cod: 'X' }) }),
    );
    expect(r.statusCode).toBe(400);
    expect(f.turni.size).toBe(0);
  });

  it('rifiuta una data inesistente', async () => {
    const r: any = await putShiftCon(f.repo)(
      evento({ pathParameters: { date: '2026-02-30' }, body: JSON.stringify({ cod: 'M' }) }),
    );
    expect(r.statusCode).toBe(400);
  });

  it('rifiuta un corpo mancante o non JSON', async () => {
    for (const body of [undefined, '', 'non json', '[]', '"stringa"']) {
      const r: any = await putShiftCon(f.repo)(
        evento({ pathParameters: { date: '2026-01-05' }, body: body as any }),
      );
      expect(r.statusCode, String(body)).toBe(400);
    }
  });

  it('rifiuta note troppo lunghe senza salvare niente', async () => {
    const r: any = await putShiftCon(f.repo)(
      evento({
        pathParameters: { date: '2026-01-05' },
        body: JSON.stringify({ cod: 'M', note: 'x'.repeat(501) }),
      }),
    );
    expect(r.statusCode).toBe(400);
    expect(f.turni.size).toBe(0);
  });
});

describe('GET /config', () => {
  it('su tabella vuota restituisce i parametri vuoti, non un errore', async () => {
    const r: any = await getConfigCon(f.repo)();
    expect(r.statusCode).toBe(200);
    expect(corpo(r).paga.tariffaOraria).toBeNull();
    expect(corpo(r).paga.rateo13a).toBeCloseTo(1 / 12, 10);
  });
});

describe('PUT /config', () => {
  it('salva parametri validi', async () => {
    const r: any = await putConfigCon(f.repo)(
      evento({
        body: JSON.stringify({
          tariffaOraria: 9.5,
          maggSabato: 0.2,
          maggDomenica: 0.3,
          maggFestivo: 0.5,
          rateo13a: 1 / 12,
          coeffNetto: 0.72,
        }),
      }),
    );
    expect(r.statusCode).toBe(200);
    expect(f.paga().tariffaOraria).toBe(9.5);
    expect(f.paga().coeffNetto).toBe(0.72);
  });

  it('i campi assenti restano vuoti invece di diventare zero', async () => {
    await putConfigCon(f.repo)(evento({ body: JSON.stringify({ tariffaOraria: 10 }) }));
    expect(f.paga().tariffaOraria).toBe(10);
    expect(f.paga().maggSabato).toBeNull();
    expect(f.paga().coeffNetto).toBeNull();
  });

  it('rifiuta una tariffa negativa', async () => {
    const r: any = await putConfigCon(f.repo)(
      evento({ body: JSON.stringify({ tariffaOraria: -1 }) }),
    );
    expect(r.statusCode).toBe(400);
  });

  it('rifiuta percentuali fuori da 0..1', async () => {
    for (const v of [1.5, -0.1, 20]) {
      const r: any = await putConfigCon(f.repo)(
        evento({ body: JSON.stringify({ tariffaOraria: 10, maggSabato: v }) }),
      );
      expect(r.statusCode, String(v)).toBe(400);
    }
  });

  it('rifiuta valori non numerici', async () => {
    const r: any = await putConfigCon(f.repo)(
      evento({ body: JSON.stringify({ tariffaOraria: 'dieci' }) }),
    );
    expect(r.statusCode).toBe(400);
  });
});

describe('risposte', () => {
  it('espongono CORS solo verso lorigine dellapp', async () => {
    const r: any = await getConfigCon(f.repo)();
    expect(r.headers['access-control-allow-origin']).toBe('https://vanessa.matteo.cool');
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('un guasto del repo diventa 500 senza rivelare dettagli', async () => {
    const rotto: Repo = {
      ...f.repo,
      leggiPaga: async () => {
        throw new Error('DynamoDB: AccessDenied su arn:aws:dynamodb:...');
      },
    };
    const r: any = await getConfigCon(rotto)();
    expect(r.statusCode).toBe(500);
    expect(String(r.body)).not.toMatch(/arn:aws/);
  });
});
