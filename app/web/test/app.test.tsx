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
  const saved: RemoteShift[] = [];
  const deleted: IsoDate[] = [];
  const bulk: { date: IsoDate; code: ShiftCode }[][] = [];
  let current = settings;
  const api: Api = {
    shifts: async () => [...shifts.values()],
    saveShift: async (s) => {
      saved.push(s);
      shifts.set(s.date, s);
    },
    deleteShift: async (d) => {
      deleted.push(d);
      shifts.delete(d);
    },
    saveShifts: async (entries) => {
      bulk.push([...entries]);
      for (const e of entries) shifts.set(e.date, { date: e.date, code: e.code });
    },
    paySettings: async () => current,
    savePaySettings: async (p) => {
      current = p;
    },
  };
  return { api, saved, deleted, bulk, settings: () => current };
}

/** A fixed "today" so the suite does not depend on the day it runs.
 *  15 January 2026 is an ordinary Thursday: no weekend, no holiday. */
const JAN = '2026-01-15';

const openDay = async (user: ReturnType<typeof userEvent.setup>, label: RegExp) =>
  user.click(await screen.findByRole('button', { name: label }));

describe('calendar layout', () => {
  it('1 January 2026 is a Thursday: the first three cells are empty', () => {
    expect(weeksOfMonth(2026, 1)[0]!.slice(0, 4)).toEqual([null, null, null, '2026-01-01']);
  });

  it('a month starting on Monday has no leading empty cells', () => {
    expect(weeksOfMonth(2026, 6)[0]![0]).toBe('2026-06-01');
  });

  it('a month starting on Sunday has six of them', () => {
    expect(weeksOfMonth(2026, 2)[0]!.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(weeksOfMonth(2026, 2)[0]![6]).toBe('2026-02-01');
  });

  it('every month holds each of its days exactly once', () => {
    for (let m = 1; m <= 12; m++) {
      const days = weeksOfMonth(2026, m).flat().filter(Boolean);
      expect(new Set(days).size).toBe(days.length);
      expect(days).toHaveLength(new Date(Date.UTC(2026, m, 0)).getUTCDate());
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

describe('navigation', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('offers the five sections in the bottom bar', async () => {
    render(<App api={fakeApi().api} today={JAN} />);
    const bar = screen.getByRole('navigation', { name: 'Sezioni' });
    for (const label of ['Calendario', 'Carica', 'Scambi', 'Riepilogo', 'Stipendio']) {
      expect(within(bar).getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('moves between months without leaving the year', async () => {
    const user = userEvent.setup();
    render(<App api={fakeApi().api} today={JAN} />);
    expect(await screen.findByRole('heading', { name: /Gennaio 2026/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mese precedente' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Mese successivo' }));
    expect(screen.getByRole('heading', { name: /Febbraio 2026/ })).toBeInTheDocument();
  });
});

describe('opening on today', () => {
  it('starts on the calendar, on the month you are living in', async () => {
    render(<App api={fakeApi().api} today="2026-08-02" />);
    expect(await screen.findByRole('heading', { name: /Agosto 2026/ })).toBeInTheDocument();
    const bar = screen.getByRole('navigation', { name: 'Sezioni' });
    expect(within(bar).getByRole('button', { name: /Calendario/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('picks today out of the grid', async () => {
    render(<App api={fakeApi().api} today="2026-08-02" />);
    const cell = await screen.findByRole('button', { name: /^2 Agosto, oggi/ });
    expect(cell.className).toContain('is-today');
    // Exactly one day is today, never two.
    expect(
      screen.getAllByRole('button').filter((b) => b.className.includes('is-today')),
    ).toHaveLength(1);
  });

  it('marks today even when it is a holiday or a weekend', async () => {
    // 15 August 2026 is Ferragosto, and a Saturday.
    render(<App api={fakeApi().api} today="2026-08-15" />);
    const cell = await screen.findByRole('button', { name: /^15 Agosto, Ferragosto, oggi/ });
    expect(cell.className).toContain('is-today');
    expect(cell.className).toContain('d-holiday');
  });

  it('falls back to January for a year the rota does not cover', async () => {
    render(<App api={fakeApi().api} today="2031-05-09" />);
    expect(await screen.findByRole('heading', { name: /Gennaio 2026/ })).toBeInTheDocument();
    expect(
      screen.queryAllByRole('button').filter((b) => b.className.includes('is-today')),
    ).toHaveLength(0);
  });

  it('marks no day as today when looking at another month', async () => {
    const user = userEvent.setup();
    render(<App api={fakeApi().api} today="2026-08-02" />);
    await screen.findByRole('heading', { name: /Agosto 2026/ });
    await user.click(screen.getByRole('button', { name: 'Mese successivo' }));
    expect(
      screen.queryAllByRole('button').filter((b) => b.className.includes('is-today')),
    ).toHaveLength(0);
  });
});

describe('day editor', () => {
  it('shows the loaded shift', async () => {
    const { api } = fakeApi([{ date: '2026-01-05', code: 'M1' }]);
    render(<App api={api} today={JAN} />);
    const cell = await screen.findByRole('button', { name: /^5 Gennaio, turno M1$/ });
    expect(within(cell).getByText('M1')).toBeInTheDocument();
    expect(within(cell).getByText('07:00-14:00')).toBeInTheDocument();
  });

  it('marks holidays even when they fall on a Saturday', async () => {
    render(<App api={fakeApi().api} today={JAN} initialMonth={4} />);
    const cell = await screen.findByRole('button', { name: /^25 Aprile, Liberazione/ });
    expect(cell.className).toContain('d-holiday');
    expect(cell.className).not.toContain('d-saturday');
  });

  it('creates a day', async () => {
    const user = userEvent.setup();
    const { api, saved } = fakeApi();
    render(<App api={api} today={JAN} />);

    await openDay(user, /^5 Gennaio, nessun turno$/);
    const sheet = screen.getByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: /P1/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ date: '2026-01-05', code: 'P1' });
    expect(await screen.findByRole('button', { name: /^5 Gennaio, turno P1$/ })).toBeInTheDocument();
  });

  it('updates a day, keeping the swap details', async () => {
    const user = userEvent.setup();
    const { api, saved } = fakeApi([
      { date: '2026-01-05', code: 'M', originalCode: 'P', colleague: 'Giulia', swapKind: 'Ho coperto' },
    ]);
    render(<App api={api} today={JAN} />);

    await openDay(user, /^5 Gennaio, turno M, scambiato$/);
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByLabelText(/Collega/)).toHaveValue('Giulia');
    await user.click(within(sheet).getByRole('button', { name: /P1/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({
      code: 'P1',
      originalCode: 'P',
      colleague: 'Giulia',
      swapKind: 'Ho coperto',
    });
  });

  it('records a swap on a day that had none', async () => {
    const user = userEvent.setup();
    const { api, saved } = fakeApi([{ date: '2026-01-05', code: 'M' }]);
    render(<App api={api} today={JAN} />);

    await openDay(user, /^5 Gennaio, turno M$/);
    const sheet = screen.getByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: /Scambio con una collega/ }));
    await user.selectOptions(within(sheet).getByLabelText(/Turno che avevo in origine/), 'P1');
    await user.type(within(sheet).getByLabelText(/Collega/), 'Anna');
    await user.selectOptions(within(sheet).getByLabelText(/Tipo di scambio/), 'Mi ha coperto');
    await user.click(within(sheet).getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({
      code: 'M',
      originalCode: 'P1',
      colleague: 'Anna',
      swapKind: 'Mi ha coperto',
    });
  });

  it('shows the hour difference of a swap', async () => {
    const user = userEvent.setup();
    render(<App api={fakeApi([{ date: '2026-01-05', code: 'P1', originalCode: 'M' }]).api} today={JAN} />);
    await openDay(user, /^5 Gennaio, turno P1, scambiato$/);
    expect(within(screen.getByRole('dialog')).getByText(/\+2/)).toBeInTheDocument();
  });

  it('deletes a day', async () => {
    const user = userEvent.setup();
    const { api, deleted } = fakeApi([{ date: '2026-01-05', code: 'M' }]);
    render(<App api={api} today={JAN} />);

    await openDay(user, /^5 Gennaio, turno M$/);
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancella giorno' }),
    );

    await waitFor(() => expect(deleted).toEqual(['2026-01-05']));
    expect(await screen.findByRole('button', { name: /^5 Gennaio, nessun turno$/ })).toBeInTheDocument();
  });

  it('cannot delete a day that does not exist yet', async () => {
    const user = userEvent.setup();
    render(<App api={fakeApi().api} today={JAN} />);
    await openDay(user, /^5 Gennaio, nessun turno$/);
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancella giorno' }),
    ).toBeDisabled();
  });

  it('rolls the cell back and shows the error when saving fails', async () => {
    const user = userEvent.setup();
    const { api } = fakeApi([{ date: '2026-01-05', code: 'M' }]);
    api.saveShift = async () => {
      throw new Error('rete non raggiungibile');
    };
    render(<App api={api} today={JAN} />);

    await openDay(user, /^5 Gennaio, turno M$/);
    const sheet = screen.getByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: /P1/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Salva' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('rete non raggiungibile');
    expect(await screen.findByRole('button', { name: /^5 Gennaio, turno M$/ })).toBeInTheDocument();
  });

  it('shows the error when the initial load fails', async () => {
    const { api } = fakeApi();
    api.shifts = async () => {
      throw new Error('API non disponibile');
    };
    render(<App api={api} today={JAN} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('API non disponibile');
  });
});

describe('bulk entry', () => {
  const goToBulk = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(within(screen.getByRole('navigation', { name: 'Sezioni' })).getByRole('button', { name: /Carica/ }));

  it('saves a whole month from a sequence', async () => {
    const user = userEvent.setup();
    const { api, bulk } = fakeApi();
    render(<App api={api} today={JAN} />);
    await goToBulk(user);

    await user.type(screen.getByLabelText(/Sequenza/), 'M M P1 L');
    await user.click(screen.getByRole('button', { name: /Salva 4 giorni/ }));

    await waitFor(() => expect(bulk).toHaveLength(1));
    expect(bulk[0]).toEqual([
      { date: '2026-01-01', code: 'M' },
      { date: '2026-01-02', code: 'M' },
      { date: '2026-01-03', code: 'P1' },
      { date: '2026-01-04', code: 'L' },
    ]);
    expect(await screen.findByRole('status')).toHaveTextContent(/Salvati 4 giorni/);
  });

  it('refuses to save while a code is unrecognised', async () => {
    const user = userEvent.setup();
    const { api, bulk } = fakeApi();
    render(<App api={api} today={JAN} />);
    await goToBulk(user);

    await user.type(screen.getByLabelText(/Sequenza/), 'M ZZ P');
    expect(await screen.findByRole('alert')).toHaveTextContent(/ZZ/);
    expect(screen.queryByRole('button', { name: /Salva \d+ giorni/ })).not.toBeInTheDocument();
    expect(bulk).toHaveLength(0);
  });

  it('refuses a sequence longer than the month', async () => {
    const user = userEvent.setup();
    render(<App api={fakeApi().api} today={JAN} />);
    await goToBulk(user);

    await user.selectOptions(screen.getByLabelText(/Mese/), '2');
    await user.type(screen.getByLabelText(/Sequenza/), Array(29).fill('M').join(' '));
    expect(await screen.findByRole('alert')).toHaveTextContent(/28 giorni/);
  });

  it('warns before overwriting days that already have a shift', async () => {
    const user = userEvent.setup();
    render(<App api={fakeApi([{ date: '2026-01-01', code: 'L' }]).api} today={JAN} />);
    await goToBulk(user);

    await user.type(screen.getByLabelText(/Sequenza/), 'P1 M');
    const table = await screen.findByRole('table');
    expect(within(table).getByText('L')).toBeInTheDocument();
    expect(within(table).getByText('P1')).toBeInTheDocument();
  });
});

describe('swaps view', () => {
  const goToSwaps = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(within(screen.getByRole('navigation', { name: 'Sezioni' })).getByRole('button', { name: /Scambi/ }));

  it('shows the favour and hour balance per colleague', async () => {
    const user = userEvent.setup();
    render(
      <App
        today={JAN}
        api={
          fakeApi([
            { date: '2026-01-05', code: 'P1', originalCode: 'M', colleague: 'Giulia', swapKind: 'Ho coperto' },
            { date: '2026-01-12', code: 'M', originalCode: 'M', colleague: 'Giulia', swapKind: 'Ho coperto' },
            { date: '2026-01-19', code: 'M', originalCode: 'P1', colleague: 'Giulia', swapKind: 'Mi ha coperto' },
          ]).api
        }
      />,
    );
    await goToSwaps(user);

    const card = (await screen.findAllByRole('listitem'))[0]!;
    expect(within(card).getByText('Giulia')).toBeInTheDocument();
    expect(within(card).getByText(/\+1 favori/)).toBeInTheDocument();
  });

  it('flags swaps with no colleague attached', async () => {
    const user = userEvent.setup();
    render(
      <App
        today={JAN}
        api={
          fakeApi([
            { date: '2026-01-05', code: 'M', originalCode: 'P', colleague: 'Anna', swapKind: 'Ho coperto' },
            { date: '2026-01-06', code: 'M', originalCode: 'P', swapKind: 'Ho coperto' },
          ]).api
        }
      />,
    );
    await goToSwaps(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(/1 scambi non hanno il nome/);
  });

  it('says so plainly when there are no swaps', async () => {
    const user = userEvent.setup();
    render(<App api={fakeApi([{ date: '2026-01-05', code: 'M' }]).api} today={JAN} />);
    await goToSwaps(user);
    expect(await screen.findByText(/non c'è ancora nessuno scambio/i)).toBeInTheDocument();
  });
});

describe('summary view', () => {
  it('counts shifts per code, worked days and hours', async () => {
    const user = userEvent.setup();
    render(
      <App
        today={JAN}
        api={
          fakeApi([
            { date: '2026-01-05', code: 'M' },
            { date: '2026-01-06', code: 'M' },
            { date: '2026-01-07', code: 'P1' },
            { date: '2026-01-08', code: 'L' },
          ]).api
        }
      />,
    );
    await user.click(
      within(screen.getByRole('navigation', { name: 'Sezioni' })).getByRole('button', { name: /Riepilogo/ }),
    );

    // 6 + 6 + 8 hours over three worked days; Libero counts for neither.
    expect(await screen.findByText(/20 ore/)).toBeInTheDocument();
    expect(screen.getByText(/3 giorni lavorati/)).toBeInTheDocument();
    const table = screen.getByRole('table');
    const january = within(table).getByRole('row', { name: /^Gen/ });
    expect(within(january).getByText('2')).toBeInTheDocument(); // two M
  });
});

describe('pay view', () => {
  const goToPay = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(within(screen.getByRole('navigation', { name: 'Sezioni' })).getByRole('button', { name: /Stipendio/ }));

  it('with no hourly rate it shows no figures, not even in the total', async () => {
    const user = userEvent.setup();
    render(<App api={fakeApi([{ date: '2026-01-05', code: 'M1' }]).api} today={JAN} />);
    await goToPay(user);

    const total = screen.getByRole('row', { name: /Totale/ });
    expect(within(total).getAllByText('–').length).toBeGreaterThanOrEqual(2);
    expect(within(total).queryByText(/€\s*0,00/)).not.toBeInTheDocument();
  });

  it('with the hourly rate filled in it computes the base and saves', async () => {
    const user = userEvent.setup();
    const { api, settings } = fakeApi([{ date: '2026-01-05', code: 'M1' }]);
    render(<App api={api} today={JAN} />);
    await goToPay(user);

    await user.type(screen.getByLabelText(/Tariffa oraria/), '10');
    await waitFor(() => expect(settings().hourlyRate).toBe(10));

    const row = screen.getByRole('row', { name: /^Gennaio/ });
    expect(within(row).getByText(/70,00/)).toBeInTheDocument();
    expect(within(row).getAllByText('–').length).toBeGreaterThanOrEqual(2);
  });

  it('clearing a field returns it to empty, not to zero', async () => {
    const user = userEvent.setup();
    const { api, settings } = fakeApi([], { ...EMPTY_PAY_SETTINGS, hourlyRate: 10 });
    render(<App api={api} today={JAN} />);
    await goToPay(user);

    await user.clear(screen.getByLabelText(/Tariffa oraria/));
    await waitFor(() => expect(settings().hourlyRate).toBeNull());
  });
});
