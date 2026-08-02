import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Codice, IsoDate, Paga } from '@vanessa/core';
import { PAGA_VUOTA } from '@vanessa/core';

import { App } from '../src/App.js';
import { oreSettimana, settimaneDelMese } from '../src/Calendario.js';
import type { Api, TurnoRemoto } from '../src/api.js';

function apiFinta(iniziali: TurnoRemoto[] = [], paga: Paga = PAGA_VUOTA) {
  const turni = new Map(iniziali.map((t) => [t.data, t]));
  const salvataggi: { data: IsoDate; cod: Codice | null }[] = [];
  let corrente = paga;
  const api: Api = {
    turni: async () => [...turni.values()],
    salvaTurno: async (data, cod) => {
      salvataggi.push({ data, cod });
      if (cod) turni.set(data, { data, cod });
      else turni.delete(data);
    },
    paga: async () => corrente,
    salvaPaga: async (p) => {
      corrente = p;
    },
  };
  return { api, salvataggi, paga: () => corrente };
}

describe('disposizione del calendario', () => {
  it('il 1 gennaio 2026 e giovedi: le prime tre caselle sono vuote', () => {
    const s = settimaneDelMese(2026, 1);
    expect(s[0]!.slice(0, 4)).toEqual([null, null, null, '2026-01-01']);
  });

  it('un mese che inizia di lunedi non ha caselle vuote in testa', () => {
    // Giugno 2026 inizia di lunedi.
    expect(settimaneDelMese(2026, 6)[0]![0]).toBe('2026-06-01');
  });

  it('un mese che inizia di domenica ne ha sei', () => {
    // Febbraio 2026 inizia di domenica.
    expect(settimaneDelMese(2026, 2)[0]!.slice(0, 6)).toEqual([
      null, null, null, null, null, null,
    ]);
    expect(settimaneDelMese(2026, 2)[0]![6]).toBe('2026-02-01');
  });

  it('ogni mese contiene tutti i suoi giorni una volta sola', () => {
    for (let m = 1; m <= 12; m++) {
      const giorni = settimaneDelMese(2026, m).flat().filter(Boolean);
      expect(new Set(giorni).size).toBe(giorni.length);
      const attesi = new Date(Date.UTC(2026, m, 0)).getUTCDate();
      expect(giorni).toHaveLength(attesi);
    }
  });

  it('ogni settimana ha sette caselle', () => {
    for (let m = 1; m <= 12; m++) {
      for (const s of settimaneDelMese(2026, m)) expect(s).toHaveLength(7);
    }
  });

  it('le ore della settimana sommano solo i giorni presenti', () => {
    const turni = new Map<IsoDate, Codice>([
      ['2026-01-01', 'M'],
      ['2026-01-02', 'P1'],
    ]);
    expect(oreSettimana(settimaneDelMese(2026, 1)[0]!, turni)).toBe(6 + 8);
    expect(oreSettimana([null, null, null], turni)).toBe(0);
  });
});

describe('app', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('mostra i turni caricati', async () => {
    const { api } = apiFinta([{ data: '2026-01-05', cod: 'M1' }]);
    render(<App api={api} />);
    const cella = await screen.findByRole('button', { name: /^5 Gennaio, turno M1$/ });
    expect(within(cella).getByText('M1')).toBeInTheDocument();
    expect(within(cella).getByText('07:00-14:00')).toBeInTheDocument();
  });

  it('segnala i festivi anche quando cadono di sabato', async () => {
    const { api } = apiFinta();
    render(<App api={api} meseIniziale={4} />);
    // 25 aprile 2026 e' sabato ed e' festivo: vince il festivo.
    const cella = await screen.findByRole('button', { name: /^25 Aprile, Liberazione/ });
    expect(cella.className).toContain('g-festivo');
    expect(cella.className).not.toContain('g-sabato');
  });

  it('salva il turno scelto e lo mostra subito', async () => {
    const utente = userEvent.setup();
    const { api, salvataggi } = apiFinta();
    render(<App api={api} />);

    await utente.click(await screen.findByRole('button', { name: /^5 Gennaio, nessun turno$/ }));
    await utente.click(within(screen.getByRole('dialog')).getByRole('button', { name: /P1/ }));

    await waitFor(() => expect(salvataggi).toEqual([{ data: '2026-01-05', cod: 'P1' }]));
    expect(await screen.findByRole('button', { name: /^5 Gennaio, turno P1$/ })).toBeInTheDocument();
  });

  it('cancella un turno esistente', async () => {
    const utente = userEvent.setup();
    const { api, salvataggi } = apiFinta([{ data: '2026-01-05', cod: 'M' }]);
    render(<App api={api} />);

    await utente.click(await screen.findByRole('button', { name: /^5 Gennaio, turno M$/ }));
    await utente.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Cancella/ }));

    await waitFor(() => expect(salvataggi).toEqual([{ data: '2026-01-05', cod: null }]));
  });

  it('se il salvataggio fallisce la cella torna indietro e compare lerrore', async () => {
    const utente = userEvent.setup();
    const { api } = apiFinta([{ data: '2026-01-05', cod: 'M' }]);
    api.salvaTurno = async () => {
      throw new Error('rete non raggiungibile');
    };
    render(<App api={api} />);

    await utente.click(await screen.findByRole('button', { name: /^5 Gennaio, turno M$/ }));
    await utente.click(within(screen.getByRole('dialog')).getByRole('button', { name: /P1/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('rete non raggiungibile');
    expect(await screen.findByRole('button', { name: /^5 Gennaio, turno M$/ })).toBeInTheDocument();
  });

  it('mostra lerrore se il caricamento iniziale fallisce', async () => {
    const { api } = apiFinta();
    api.turni = async () => {
      throw new Error('API non disponibile');
    };
    render(<App api={api} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('API non disponibile');
  });

  it('si sposta fra i mesi e non esce dallanno', async () => {
    const utente = userEvent.setup();
    const { api } = apiFinta();
    render(<App api={api} />);

    expect(await screen.findByRole('heading', { name: /Gennaio 2026/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mese precedente' })).toBeDisabled();

    await utente.click(screen.getByRole('button', { name: 'Mese successivo' }));
    expect(screen.getByRole('heading', { name: /Febbraio 2026/ })).toBeInTheDocument();
  });
});

describe('stipendio', () => {
  it('senza tariffa non mostra cifre, nemmeno nel totale', async () => {
    const utente = userEvent.setup();
    const { api } = apiFinta([{ data: '2026-01-05', cod: 'M1' }]);
    render(<App api={api} />);
    await screen.findByRole('button', { name: /^5 Gennaio, turno M1$/ });
    await utente.click(screen.getByRole('button', { name: 'Stipendio' }));

    const totale = screen.getByRole('row', { name: /Totale/ });
    expect(within(totale).getAllByText('–').length).toBeGreaterThanOrEqual(2);
    expect(within(totale).queryByText(/€\s*0,00/)).not.toBeInTheDocument();
  });

  it('con la tariffa compilata calcola e salva', async () => {
    const utente = userEvent.setup();
    const { api, paga } = apiFinta([{ data: '2026-01-05', cod: 'M1' }]);
    render(<App api={api} />);
    await screen.findByRole('button', { name: /^5 Gennaio, turno M1$/ });
    await utente.click(screen.getByRole('button', { name: 'Stipendio' }));

    await utente.type(screen.getByLabelText(/Tariffa oraria/), '10');
    await waitFor(() => expect(paga().tariffaOraria).toBe(10));

    // 7 ore di M1 a 10 euro, piu' il rateo di un dodicesimo.
    const riga = screen.getByRole('row', { name: /^Gennaio/ });
    expect(within(riga).getByText(/75,83/)).toBeInTheDocument();
  });

  it('le percentuali si scrivono in centesimi e si salvano in frazione', async () => {
    const utente = userEvent.setup();
    const { api, paga } = apiFinta();
    render(<App api={api} />);
    await utente.click(screen.getByRole('button', { name: 'Stipendio' }));

    await utente.type(screen.getByLabelText(/Maggiorazione sabato/), '20');
    await waitFor(() => expect(paga().maggSabato).toBeCloseTo(0.2, 10));
  });

  it('svuotare un parametro lo riporta a vuoto, non a zero', async () => {
    const utente = userEvent.setup();
    const { api, paga } = apiFinta([], { ...PAGA_VUOTA, tariffaOraria: 10 });
    render(<App api={api} />);
    await utente.click(screen.getByRole('button', { name: 'Stipendio' }));

    await utente.clear(screen.getByLabelText(/Tariffa oraria/));
    await waitFor(() => expect(paga().tariffaOraria).toBeNull());
  });
});
