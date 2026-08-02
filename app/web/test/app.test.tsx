import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IsoDate, PaySettings, ShiftCode } from '@vanessa/core';
import { EMPTY_PAY_SETTINGS } from '@vanessa/core';

import { App } from '../src/App.js';
import { weekHours, weeksOfMonth } from '../src/Calendar.js';
import type { Api, RemoteShift } from '../src/api.js';

function fakeApi(initial: RemoteShift[] = [], settings: PaySettings = EMPTY_PAY_SETTINGS) {
  const shifts = new Map(initial.map((s) => [s.date, s]));
  const saves: { date: IsoDate; code: ShiftCode | null }[] = [];
  let current = settings;
  const api: Api = {
    shifts: async () => [...shifts.values()],
    saveShift: async (date, code) => {
      saves.push({ date, code });
      if (code) shifts.set(date, { date, code });
      else shifts.delete(date);
    },
    paySettings: async () => current,
    savePaySettings: async (p) => {
      current = p;
    },
  };
  return { api, saves, settings: () => current };
}

describe('calendar layout', () => {
  it('1 January 2026 is a Thursday: the first three cells are empty', () => {
    const w = weeksOfMonth(2026, 1);
    expect(w[0]!.slice(0, 4)).toEqual([null, null, null, '2026-01-01']);
  });

  it('a month starting on Monday has no leading empty cells', () => {
    // June 2026 starts on a Monday.
    expect(weeksOfMonth(2026, 6)[0]![0]).toBe('2026-06-01');
  });

  it('a month starting on Sunday has six of them', () => {
    // February 2026 starts on a Sunday.
    expect(weeksOfMonth(2026, 2)[0]!.slice(0, 6)).toEqual([
      null, null, null, null, null, null,
    ]);
    expect(weeksOfMonth(2026, 2)[0]![6]).toBe('2026-02-01');
  });

  it('every month holds each of its days exactly once', () => {
    for (let m = 1; m <= 12; m++) {
      const days = weeksOfMonth(2026, m).flat().filter(Boolean);
      expect(new Set(days).size).toBe(days.length);
      const expected = new Date(Date.UTC(2026, m, 0)).getUTCDate();
      expect(days).toHaveLength(expected);
    }
  });

  it('every week has seven cells', () => {
    for (let m = 1; m <= 12; m++) {
      for (const w of weeksOfMonth(2026, m)) expect(w).toHaveLength(7);
    }
  });

  it('weekly hours sum only the days present', () => {
    const shifts = new Map<IsoDate, ShiftCode>([
      ['2026-01-01', 'M'],
      ['2026-01-02', 'P1'],
    ]);
    expect(weekHours(weeksOfMonth(2026, 1)[0]!, shifts)).toBe(6 + 8);
    expect(weekHours([null, null, null], shifts)).toBe(0);
  });
});

describe('app', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows the loaded shifts', async () => {
    const { api } = fakeApi([{ date: '2026-01-05', code: 'M1' }]);
    render(<App api={api} />);
    const cell = await screen.findByRole('button', { name: /^5 Gennaio, turno M1$/ });
    expect(within(cell).getByText('M1')).toBeInTheDocument();
    expect(within(cell).getByText('07:00-14:00')).toBeInTheDocument();
  });

  it('marks holidays even when they fall on a Saturday', async () => {
    const { api } = fakeApi();
    render(<App api={api} initialMonth={4} />);
    // 25 April 2026 is a Saturday and a holiday: the holiday wins.
    const cell = await screen.findByRole('button', { name: /^25 Aprile, Liberazione/ });
    expect(cell.className).toContain('d-holiday');
    expect(cell.className).not.toContain('d-saturday');
  });

  it('saves the chosen shift and shows it at once', async () => {
    const user = userEvent.setup();
    const { api, saves } = fakeApi();
    render(<App api={api} />);

    await user.click(await screen.findByRole('button', { name: /^5 Gennaio, nessun turno$/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /P1/ }));

    await waitFor(() => expect(saves).toEqual([{ date: '2026-01-05', code: 'P1' }]));
    expect(await screen.findByRole('button', { name: /^5 Gennaio, turno P1$/ })).toBeInTheDocument();
  });

  it('deletes an existing shift', async () => {
    const user = userEvent.setup();
    const { api, saves } = fakeApi([{ date: '2026-01-05', code: 'M' }]);
    render(<App api={api} />);

    await user.click(await screen.findByRole('button', { name: /^5 Gennaio, turno M$/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Cancella/ }));

    await waitFor(() => expect(saves).toEqual([{ date: '2026-01-05', code: null }]));
  });

  it('rolls the cell back and shows the error when saving fails', async () => {
    const user = userEvent.setup();
    const { api } = fakeApi([{ date: '2026-01-05', code: 'M' }]);
    api.saveShift = async () => {
      throw new Error('rete non raggiungibile');
    };
    render(<App api={api} />);

    await user.click(await screen.findByRole('button', { name: /^5 Gennaio, turno M$/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /P1/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('rete non raggiungibile');
    expect(await screen.findByRole('button', { name: /^5 Gennaio, turno M$/ })).toBeInTheDocument();
  });

  it('shows the error when the initial load fails', async () => {
    const { api } = fakeApi();
    api.shifts = async () => {
      throw new Error('API non disponibile');
    };
    render(<App api={api} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('API non disponibile');
  });

  it('moves between months without leaving the year', async () => {
    const user = userEvent.setup();
    const { api } = fakeApi();
    render(<App api={api} />);

    expect(await screen.findByRole('heading', { name: /Gennaio 2026/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mese precedente' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Mese successivo' }));
    expect(screen.getByRole('heading', { name: /Febbraio 2026/ })).toBeInTheDocument();
  });
});

describe('pay view', () => {
  it('with no hourly rate it shows no figures, not even in the total', async () => {
    const user = userEvent.setup();
    const { api } = fakeApi([{ date: '2026-01-05', code: 'M1' }]);
    render(<App api={api} />);
    await screen.findByRole('button', { name: /^5 Gennaio, turno M1$/ });
    await user.click(screen.getByRole('button', { name: 'Stipendio' }));

    const total = screen.getByRole('row', { name: /Totale/ });
    expect(within(total).getAllByText('–').length).toBeGreaterThanOrEqual(2);
    expect(within(total).queryByText(/€\s*0,00/)).not.toBeInTheDocument();
  });

  it('with the hourly rate filled in it computes and saves', async () => {
    const user = userEvent.setup();
    const { api, settings } = fakeApi([{ date: '2026-01-05', code: 'M1' }]);
    render(<App api={api} />);
    await screen.findByRole('button', { name: /^5 Gennaio, turno M1$/ });
    await user.click(screen.getByRole('button', { name: 'Stipendio' }));

    await user.type(screen.getByLabelText(/Tariffa oraria/), '10');
    await waitFor(() => expect(settings().hourlyRate).toBe(10));

    // 7 hours of M1 at 10 euro: base pay is true even without the premiums.
    const row = () => screen.getByRole('row', { name: /^Gennaio/ });
    expect(within(row()).getByText(/70,00/)).toBeInTheDocument();
    // The gross is not: without every percentage it would understate the pay.
    expect(within(row()).getAllByText('–').length).toBeGreaterThanOrEqual(2);

    for (const [label, value] of [
      [/Maggiorazione sabato/, '20'],
      [/Maggiorazione domenica/, '30'],
      [/Maggiorazione festivo/, '50'],
    ] as const) {
      await user.type(screen.getByLabelText(label), value);
    }

    // January 2026 has no Saturday, Sunday or holiday hours in this scenario,
    // so the gross is the base plus one twelfth of accrual.
    await waitFor(() => expect(within(row()).getByText(/75,83/)).toBeInTheDocument());
  });

  it('percentages are typed in hundredths and stored as fractions', async () => {
    const user = userEvent.setup();
    const { api, settings } = fakeApi();
    render(<App api={api} />);
    await user.click(screen.getByRole('button', { name: 'Stipendio' }));

    await user.type(screen.getByLabelText(/Maggiorazione sabato/), '20');
    await waitFor(() => expect(settings().saturdayPremium).toBeCloseTo(0.2, 10));
  });

  it('clearing a field returns it to empty, not to zero', async () => {
    const user = userEvent.setup();
    const { api, settings } = fakeApi([], { ...EMPTY_PAY_SETTINGS, hourlyRate: 10 });
    render(<App api={api} />);
    await user.click(screen.getByRole('button', { name: 'Stipendio' }));

    await user.clear(screen.getByLabelText(/Tariffa oraria/));
    await waitFor(() => expect(settings().hourlyRate).toBeNull());
  });
});
