import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { IsoDate, MonthRoster } from '@vanessa/core';

import type { RemoteShift } from '../src/api.js';
import { Oggi } from '../src/Oggi.js';

/** Monday 16 November 2026. */
const OGGI = '2026-11-16';

function turni(entries: Record<IsoDate, RemoteShift['code']>): Map<IsoDate, RemoteShift> {
  return new Map(Object.entries(entries).map(([date, code]) => [date, { date, code }]));
}

/** A November roster: Anna on M every day, Sara on P every day, Carla on F. */
const NOVEMBRE: MonthRoster = {
  year: 2026,
  month: 11,
  people: [
    { name: 'Anna', row: 1, codes: Array<string>(30).fill('M') },
    { name: 'Sara', row: 2, codes: Array<string>(30).fill('P') },
    { name: 'Carla', row: 3, codes: Array<string>(30).fill('F') },
  ],
};

function renderOggi(
  days: Map<IsoDate, RemoteShift>,
  roster: (year: number, month: number) => Promise<MonthRoster | null> = async (_y, m) =>
    m === 11 ? NOVEMBRE : null,
  today: IsoDate = OGGI,
) {
  const api = { roster: vi.fn(roster) };
  render(<Oggi today={today} year={2026} days={days} api={api} />);
  return api;
}

/** The card of one day, found by its heading. */
const giorno = (name: RegExp) => within(screen.getByRole('article', { name }));

describe('Oggi', () => {
  it('welcomes her with the date of today', () => {
    renderOggi(new Map());
    expect(screen.getByRole('heading', { name: 'Ciao Vanessa' })).toBeInTheDocument();
    expect(screen.getByText('lunedì 16 novembre')).toBeInTheDocument();
  });

  it('shows five days from today, naming today and tomorrow', () => {
    renderOggi(new Map());
    const titoli = screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'));
    expect(titoli).toEqual([
      'Oggi, lunedì 16 novembre',
      'Domani, martedì 17 novembre',
      'mercoledì 18 novembre',
      'giovedì 19 novembre',
      'venerdì 20 novembre',
    ]);
  });

  it('gives the shift with its name and hours', () => {
    renderOggi(turni({ '2026-11-16': 'M' }));
    expect(giorno(/^Oggi/).getByText('M')).toBeInTheDocument();
    expect(giorno(/^Oggi/).getByText('Mattina · 07:00–13:00')).toBeInTheDocument();
  });

  it('says so when a day has no shift entered', () => {
    renderOggi(new Map());
    expect(giorno(/^Oggi/).getByText('Nessun turno inserito')).toBeInTheDocument();
  });

  it('on a free day says Libero and lists nobody', async () => {
    renderOggi(turni({ '2026-11-16': 'L', '2026-11-17': 'M' }));
    expect(giorno(/^Oggi/).getByText('Libero')).toBeInTheDocument();
    // Wait for the roster to have loaded before trusting the absence.
    await screen.findAllByText(/Con te/);
    expect(giorno(/^Oggi/).queryByText(/Con te|In reparto/)).not.toBeInTheDocument();
  });

  it('separates who overlaps her hours from who else is on the ward', async () => {
    renderOggi(turni({ '2026-11-17': 'M' }));
    expect(await giorno(/^Domani/).findByText('Con te: Anna (M)')).toBeInTheDocument();
    expect(giorno(/^Domani/).getByText('In reparto anche: Sara (P)')).toBeInTheDocument();
  });

  // F, R, C on the sheet are holidays, rest days and the like: Carla is not
  // on the ward, whatever the letter. Only the shifts the app knows count.
  it('leaves out colleagues whose code is not a shift the app knows', async () => {
    renderOggi(turni({ '2026-11-17': 'M' }));
    await giorno(/^Domani/).findByText(/Con te/);
    expect(giorno(/^Domani/).queryByText(/Carla/)).not.toBeInTheDocument();
  });

  it('loads the roster of both months when the five days cross into the next', async () => {
    const api = renderOggi(turni({ '2026-11-30': 'P' }), async (_y, m) => (m === 11 ? NOVEMBRE : null), '2026-11-28');
    await screen.findAllByText(/Con te/);
    expect(api.roster.mock.calls.map((c) => c[1]).sort()).toEqual([11, 12]);
  });

  it('says once that a month has not been read, instead of an empty list', async () => {
    renderOggi(turni({ '2026-11-16': 'M', '2026-11-17': 'M' }), async () => null);
    expect(await screen.findByText('Le colleghe di novembre non sono ancora state lette.')).toBeInTheDocument();
    expect(screen.getAllByText(/non sono ancora state lette/)).toHaveLength(1);
  });

  it('asks for no roster outside the year the app covers', async () => {
    const api = renderOggi(new Map(), async () => null, '2026-12-30');
    await screen.findByText(/dicembre non sono ancora state lette/);
    expect(api.roster.mock.calls.map((c) => [c[0], c[1]])).toEqual([[2026, 12]]);
  });
});
