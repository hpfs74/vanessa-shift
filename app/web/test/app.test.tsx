import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DayEntry, IsoDate, PaySettings, Profile, ShiftCode } from '@vanessa/core';
import { EMPTY_PAY_SETTINGS, EMPTY_PROFILE } from '@vanessa/core';

import { App } from '../src/App.js';
import { weekHours, weeksOfMonth } from '../src/Calendar.js';
import type { Api, RemoteShift } from '../src/api.js';

function fakeApi(initial: RemoteShift[] = [], settings: PaySettings = EMPTY_PAY_SETTINGS) {
  const shifts = new Map(initial.map((s) => [s.date, s]));
  const saved: RemoteShift[] = [];
  const deleted: IsoDate[] = [];
  const bulk: { date: IsoDate; code: ShiftCode }[][] = [];
  let current = settings;
  let currentProfile: Profile = EMPTY_PROFILE;
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
    config: async () => ({ pay: current, profile: currentProfile, quota: { used: 0 } }),
    paySettings: async () => current,
    savePaySettings: async (p) => {
      current = p;
    },
    saveProfile: async (p) => {
      currentProfile = p;
    },
    readPhoto: async () => {
      throw new Error('not used in these tests');
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
    const shifts = new Map<IsoDate, DayEntry>([
      ['2026-01-01', { code: 'M' }],
      ['2026-01-02', { code: 'P1' }],
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

describe('per-day hours', () => {
  it('shows the shift hours as a placeholder, not as a value', async () => {
    const user = userEvent.setup();
    render(<App api={fakeApi([{ date: '2026-01-05', code: 'M' }]).api} today={JAN} />);
    await openDay(user, /^5 Gennaio, turno M$/);
    const field = within(screen.getByRole('dialog')).getByLabelText(/Ore effettivamente/);
    expect(field).toHaveValue(null);
    expect(field).toHaveAttribute('placeholder', expect.stringContaining('6'));
  });

  it('saves the hours typed for that day', async () => {
    const user = userEvent.setup();
    const { api, saved } = fakeApi([{ date: '2026-01-05', code: 'M' }]);
    render(<App api={api} today={JAN} />);

    await openDay(user, /^5 Gennaio, turno M$/);
    const sheet = screen.getByRole('dialog');
    await user.type(within(sheet).getByLabelText(/Ore effettivamente/), '4.5');
    await user.click(within(sheet).getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ code: 'M', hoursOverride: 4.5 });
  });

  it('keeps a zero: went in and was sent home is not the same as untouched', async () => {
    const user = userEvent.setup();
    const { api, saved } = fakeApi([{ date: '2026-01-05', code: 'M' }]);
    render(<App api={api} today={JAN} />);

    await openDay(user, /^5 Gennaio, turno M$/);
    const sheet = screen.getByRole('dialog');
    await user.type(within(sheet).getByLabelText(/Ore effettivamente/), '0');
    await user.click(within(sheet).getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.hoursOverride).toBe(0);
  });

  it('clearing the field goes back to the shift hours', async () => {
    const user = userEvent.setup();
    const { api, saved } = fakeApi([{ date: '2026-01-05', code: 'M', hoursOverride: 3 }]);
    render(<App api={api} today={JAN} />);

    await openDay(user, /^5 Gennaio, turno M, 3 ore$/);
    const sheet = screen.getByRole('dialog');
    await user.clear(within(sheet).getByLabelText(/Ore effettivamente/));
    await user.click(within(sheet).getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.hoursOverride).toBeNull();
  });

  it('refuses hours a day cannot hold', async () => {
    const user = userEvent.setup();
    const { api, saved } = fakeApi([{ date: '2026-01-05', code: 'M' }]);
    render(<App api={api} today={JAN} />);

    await openDay(user, /^5 Gennaio, turno M$/);
    const sheet = screen.getByRole('dialog');
    await user.type(within(sheet).getByLabelText(/Ore effettivamente/), '30');
    expect(within(sheet).getByRole('alert')).toHaveTextContent(/fra 0 e 24/);
    expect(within(sheet).getByRole('button', { name: 'Salva' })).toBeDisabled();
    expect(saved).toHaveLength(0);
  });

  it('marks the day in the grid and shows the real hours', async () => {
    render(<App api={fakeApi([{ date: '2026-01-05', code: 'M', hoursOverride: 3 }]).api} today={JAN} />);
    const cell = await screen.findByRole('button', { name: /^5 Gennaio, turno M, 3 ore$/ });
    expect(cell.className).toContain('has-override');
    expect(within(cell).getByText('3 ore')).toBeInTheDocument();
  });

  it('counts the override in the week, the month and the summary', async () => {
    const user = userEvent.setup();
    // 5 and 6 January are Monday and Tuesday of the same week; M is 6h each.
    render(
      <App
        today={JAN}
        api={
          fakeApi([
            { date: '2026-01-05', code: 'M', hoursOverride: 2 },
            { date: '2026-01-06', code: 'M' },
          ]).api
        }
      />,
    );
    const total = await screen.findByText(/giorni lavorati/);
    expect(total).toHaveTextContent('8 ore · 2 giorni lavorati');

    await user.click(
      within(screen.getByRole('navigation', { name: 'Sezioni' })).getByRole('button', {
        name: /Riepilogo/,
      }),
    );
    expect(await screen.findByText(/8 ore/)).toBeInTheDocument();
  });

  it('uses the override for the swap hour difference', async () => {
    const user = userEvent.setup();
    // Rostered M (6h), covered P1 (8h) but actually worked 5.
    render(
      <App
        today={JAN}
        api={
          fakeApi([
            { date: '2026-01-05', code: 'P1', hoursOverride: 5, originalCode: 'M' },
          ]).api
        }
      />,
    );
    await openDay(user, /^5 Gennaio, turno P1, 5 ore, scambiato$/);
    const hint = within(screen.getByRole('dialog')).getByText(/Differenza ore/);
    expect(hint).toHaveTextContent('-1');
    expect(hint).toHaveTextContent(/meno del previsto/);
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

describe('while the data is still loading', () => {
  /** An API whose read never resolves: the app stays in its loading state. */
  function apiThatHangs(): Api {
    const never = () => new Promise<never>(() => {});
    return {
      shifts: never,
      saveShift: never,
      deleteShift: never,
      saveShifts: never,
      config: never,
      paySettings: never,
      savePaySettings: never,
      saveProfile: never,
      readPhoto: never,
    };
  }

  it('says it is loading instead of showing a confident zero', async () => {
    const user = userEvent.setup();
    render(<App api={apiThatHangs()} today={JAN} />);

    expect(screen.getByText(/Carico i turni/)).toBeInTheDocument();

    // Every view, not just the calendar: a summary reading "0 ore" during the
    // fetch looks like an empty year rather than an unread one.
    for (const tab of [/Riepilogo/, /Scambi/, /Stipendio/, /Carica/]) {
      await user.click(
        within(screen.getByRole('navigation', { name: 'Sezioni' })).getByRole('button', {
          name: tab,
        }),
      );
      expect(screen.getByText(/Carico i turni/), String(tab)).toBeInTheDocument();
      expect(screen.queryByText(/0 giorni lavorati/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Nessuna ora registrata/)).not.toBeInTheDocument();
    }
  });
});

describe('summary charts', () => {
  const goToSummary = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(
      within(screen.getByRole('navigation', { name: 'Sezioni' })).getByRole('button', {
        name: /Riepilogo/,
      }),
    );

  it('draws hours per shift and days per code', async () => {
    const user = userEvent.setup();
    render(
      <App
        today={JAN}
        api={
          fakeApi([
            { date: '2026-01-05', code: 'M' }, // 6h
            { date: '2026-01-07', code: 'M' }, // 6h
            { date: '2026-01-08', code: 'P1' }, // 8h
            { date: '2026-01-09', code: 'L' }, // 0h
          ]).api
        }
      />,
    );
    await goToSummary(user);

    const hours = screen.getByRole('img', { name: /^Ore per turno/ });
    expect(hours).toHaveAccessibleName(/M 12 ore, 60%/);
    expect(hours).toHaveAccessibleName(/P1 8 ore, 40%/);
    // Libero is 0 hours: it has no place in an hours chart.
    expect(hours).not.toHaveAccessibleName(/L /);

    const days = screen.getByRole('img', { name: /^Giorni per codice/ });
    expect(days).toHaveAccessibleName(/M 2 giorni/);
    expect(days).toHaveAccessibleName(/L 1 giorni/);
  });

  it('counts the hours actually worked, not the shift nominal ones', async () => {
    const user = userEvent.setup();
    render(
      <App
        today={JAN}
        api={fakeApi([{ date: '2026-01-05', code: 'P1', hoursOverride: 2 }]).api}
      />,
    );
    await goToSummary(user);
    expect(screen.getByRole('img', { name: /^Ore per turno/ })).toHaveAccessibleName(
      /P1 2 ore/,
    );
  });

  it('says there is nothing to draw on an empty year', async () => {
    const user = userEvent.setup();
    render(<App api={fakeApi().api} today={JAN} />);
    await goToSummary(user);
    expect(screen.getByText(/Nessuna ora registrata/)).toBeInTheDocument();
    expect(screen.getByText(/Nessun giorno registrato/)).toBeInTheDocument();
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

describe('profilo', () => {
  it('opens from the header and goes back', async () => {
    // The bottom bar stays at five: on 375px a sixth tab drops each one to
    // 62px, and the labels do not fit. The profile is opened twice a year.
    const user = userEvent.setup();
    render(<App api={fakeApi().api} today={JAN} />);
    await user.click(await screen.findByRole('button', { name: 'Profilo' }));
    expect(await screen.findByRole('heading', { name: 'Profilo' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Indietro' }));
    expect(screen.queryByRole('heading', { name: 'Profilo' })).not.toBeInTheDocument();
  });

  it('leaves the bottom bar at five sections', async () => {
    const user = userEvent.setup();
    render(<App api={fakeApi().api} today={JAN} />);
    await user.click(await screen.findByRole('button', { name: 'Profilo' }));
    const bar = screen.getByRole('navigation', { name: 'Sezioni' });
    expect(bar.querySelectorAll('button')).toHaveLength(5);
  });

  it('tapping a tab while the profile is open closes it and switches the view', async () => {
    const user = userEvent.setup();
    render(<App api={fakeApi().api} today={JAN} />);
    await user.click(await screen.findByRole('button', { name: 'Profilo' }));
    expect(await screen.findByRole('heading', { name: 'Profilo' })).toBeInTheDocument();

    await user.click(
      within(screen.getByRole('navigation', { name: 'Sezioni' })).getByRole('button', {
        name: /Riepilogo/,
      }),
    );

    expect(screen.queryByRole('heading', { name: 'Profilo' })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Sezioni' })).getByRole('button', {
        name: /Riepilogo/,
      }),
    ).toHaveAttribute('aria-current', 'true');
  });
});

describe('esportazione nel calendario', () => {
  it('offers the export on a month with shifts in it', async () => {
    const f = fakeApi([{ date: '2026-01-05', code: 'M' }]);
    render(<App api={f.api} today={JAN} />);
    expect(await screen.findByRole('button', { name: 'Esporta nel calendario' })).toBeEnabled();
  });

  it('disables it on a month with nothing to export', async () => {
    // An empty file imports with no error and no effect, which looks exactly
    // like a broken export. Better to say there is nothing to send.
    render(<App api={fakeApi().api} today={JAN} />);
    expect(await screen.findByRole('button', { name: 'Esporta nel calendario' })).toBeDisabled();
  });

  it('treats a month of Libero as nothing to export', async () => {
    // `L` has no hours, so it produces no event: a month of Libero and an
    // empty month are the same case.
    const f = fakeApi([{ date: '2026-01-05', code: 'L' }]);
    render(<App api={f.api} today={JAN} />);
    expect(await screen.findByRole('button', { name: 'Esporta nel calendario' })).toBeDisabled();
  });

  it('exports the month on screen, not the month it opened on', async () => {
    // The button calls esportaMese(YEAR, month, entries) with the month held
    // in state, not the month the app started on. If that ever regresses to
    // a literal, the file downloaded here would be named for January instead
    // of the February the user actually navigated to and is looking at.
    const user = userEvent.setup();
    // jsdom has neither object URLs nor a real download, so both are
    // stubbed — the same gap esportaTurni.test.ts works around.
    if (typeof URL.createObjectURL !== 'function') {
      URL.createObjectURL = () => '';
      URL.revokeObjectURL = () => {};
    }
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:finto');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    // Real document.createElement, just with every <a> it makes recorded, so
    // the anchor esportaMese builds is inspectable without disturbing what
    // React itself creates while rendering.
    const originalCreateElement = document.createElement.bind(document);
    const anchors: HTMLAnchorElement[] = [];
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'a') anchors.push(el as HTMLAnchorElement);
      return el;
    });

    const f = fakeApi([{ date: '2026-02-10', code: 'M' }]);
    render(<App api={f.api} today={JAN} />);
    await user.click(await screen.findByRole('button', { name: 'Mese successivo' }));
    await user.click(await screen.findByRole('button', { name: 'Esporta nel calendario' }));

    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.download).toBe('turni-2026-02.ics');

    vi.restoreAllMocks();
  });
});
