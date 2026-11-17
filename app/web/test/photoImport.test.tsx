import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MonthRoster, PhotoReading, IsoDate, RosterPerson, SecondRead, ShiftCode } from '@vanessa/core';
import { SHORT_DAY_NAMES } from '@vanessa/core';

import { PhotoImport } from '../src/PhotoImport.js';

/** July as it stands on the photo: nothing until the 16th, then fifteen shifts. */
const JULY: readonly (ShiftCode | null)[] = [
  ...Array<null>(16).fill(null),
  'M','M','P','L','P','M','M','M','L','P','M','M','M','L','P',
];

function julyReading(unsure: readonly number[] = []): PhotoReading {
  return {
    month: 7,
    year: 2026,
    found: true,
    foundName: 'Vanessa',
    foundRow: 14,
    days: JULY.map((code, i) => ({
      day: i + 1,
      code,
      confident: !unsure.includes(i + 1),
    })),
  };
}

/** jsdom has neither canvas nor createImageBitmap: the real resizing is
 *  tested on a browser. By replacing the module, the test enters through the
 *  file input the same way Vanessa does, instead of bypassing the component
 *  from the inside. */
vi.mock('../src/image.js', () => ({
  MAX_EDGE: 2576,
  scaleFor: () => 1,
  resize: () => Promise.resolve('AAAA'),
}));

/** What the second reading would answer for `reading`: her row exactly as
 *  call 1 read it (so the checksum passes), plus `people`. */
function secondFor(reading: PhotoReading, people: readonly RosterPerson[] = []): SecondRead {
  return {
    month: reading.month,
    year: reading.year,
    rows: [
      { name: reading.foundName, row: reading.foundRow, codes: reading.days.map((d) => d.code ?? '') },
      ...people.map((p) => ({ name: p.name, row: p.row, codes: [...p.codes] })),
    ],
  };
}

/** Extra behaviour beyond the reading itself: what the second reading
 *  answers (a value, an error, or a promise the test settles itself), and
 *  custom `onSave`/`onSaveRoster` implementations for tests that need to
 *  observe order or failure rather than just success. */
interface RenderOverrides {
  second?: SecondRead | Error | Promise<SecondRead>;
  onSave?: (entries: readonly { date: IsoDate; code: ShiftCode }[]) => Promise<void>;
  onSaveRoster?: (r: MonthRoster) => Promise<void>;
}

async function renderWith(
  reading: PhotoReading,
  existing = new Map<IsoDate, ShiftCode>(),
  overrides: RenderOverrides = {},
) {
  const onSave = vi.fn(overrides.onSave ?? (async () => {}));
  const onSaveRoster = vi.fn(overrides.onSaveRoster ?? (async () => {}));
  // Call 1's roster is always empty now: the other rows have a call of their own.
  const onRead = vi.fn().mockResolvedValue({
    reading,
    roster: { year: reading.year, month: reading.month, people: [] },
  });
  // By default the second reading agrees with her row and finds nobody else:
  // most tests here only exercise her own row.
  const second = overrides.second ?? secondFor(reading);
  const onReadRoster = vi.fn(() =>
    second instanceof Error ? Promise.reject(second) : Promise.resolve(second),
  );
  const { container } = render(
    <PhotoImport
      year={2026}
      existing={existing}
      onRead={onRead}
      onReadRoster={onReadRoster}
      onSave={onSave}
      onSaveRoster={onSaveRoster}
    />,
  );

  await userEvent.upload(
    screen.getByLabelText(/Leggi da una foto/i),
    new File(['finta'], 'foglio.jpeg', { type: 'image/jpeg' }),
  );
  return { onSave, onSaveRoster, onRead, onReadRoster, container };
}

/** Presses whichever save button `SavePlan` is currently showing — its label
 *  names the day count, which varies test to test — and waits for it. */
async function salva() {
  await userEvent.click(await screen.findByRole('button', { name: /^Salva \d+ giorni$/ }));
}

describe('PhotoImport', () => {
  it('shows the month and the row it found', async () => {
    await renderWith(julyReading());
    expect(await screen.findByText(/Luglio 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/Vanessa/)).toBeInTheDocument();
  });

  // A photo cropped past the row number is still a usable photo: the grid
  // arrives, and only the number in brackets is missing.
  it('shows the row it found even when the sheet had no row number', async () => {
    await renderWith({ ...julyReading(), foundRow: null });
    expect(await screen.findByText(/riga trovata: Vanessa/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salva 15 giorni/ })).toBeInTheDocument();
  });

  it('counts the days without a shift instead of saving them', async () => {
    await renderWith(julyReading());
    expect(await screen.findByText(/16 senza turno/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salva 15 giorni/ })).toBeInTheDocument();
  });

  it('saves only the days with a shift, starting on the 17th', async () => {
    const { onSave } = await renderWith(julyReading());
    await userEvent.click(await screen.findByRole('button', { name: /Salva 15 giorni/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const sent = onSave.mock.calls[0][0];
    expect(sent).toHaveLength(15);
    expect(sent[0]).toEqual({ date: '2026-07-17', code: 'M' });
  });

  it('marks the cells the model did not read with confidence', async () => {
    await renderWith(julyReading([23]));
    const cell = await screen.findByRole('button', { name: /^23 / });
    expect(cell).toHaveClass('unsure');
  });

  it('correcting a cell changes what would be saved', async () => {
    const { onSave } = await renderWith(julyReading([23]));

    await userEvent.click(await screen.findByRole('button', { name: /^23 / }));
    await userEvent.click(screen.getByRole('button', { name: /^P1/ }));
    await userEvent.click(screen.getByRole('button', { name: /Salva 15 giorni/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const sent = onSave.mock.calls[0][0];
    expect(sent.find((s: any) => s.date === '2026-07-23')).toEqual({
      date: '2026-07-23',
      code: 'P1',
    });
  });

  it('the shift can be removed from a day, and then it is not saved', async () => {
    const { onSave } = await renderWith(julyReading());

    await userEvent.click(await screen.findByRole('button', { name: /^17 / }));
    // Exact name: a loose /Nessun turno/i would also match every blank grid
    // cell underneath the sheet ("1 nessun turno", "2 nessun turno", ...),
    // since the sheet overlays the grid rather than replacing it.
    await userEvent.click(screen.getByRole('button', { name: 'Nessun turno' }));
    await userEvent.click(screen.getByRole('button', { name: /Salva 14 giorni/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const sent = onSave.mock.calls[0][0];
    expect(sent).toHaveLength(14);
    expect(sent.find((s: any) => s.date === '2026-07-17')).toBeUndefined();
  });

  it('warns when days would be overwritten', async () => {
    const existing = new Map<IsoDate, ShiftCode>([['2026-07-17', 'L']]);
    const { container } = await renderWith(julyReading(), existing);
    // The count sits in its own <strong>, so a plain findByText (matching
    // only text a node owns directly) would miss it; toHaveTextContent
    // checks the full text of the summary line, nested elements included.
    await waitFor(() => {
      expect(container.querySelector('.summary-line')).toHaveTextContent(/1 da sovrascrivere/);
    });
  });

  it('rejects a photo from another year instead of saving wrong dates', async () => {
    await renderWith({ ...julyReading(), year: 2025 });
    expect(await screen.findByRole('alert')).toHaveTextContent(/2025/);
    expect(screen.queryByRole('button', { name: /^Salva/ })).not.toBeInTheDocument();
  });

  it('the month can be corrected, and the days follow', async () => {
    const { onSave } = await renderWith(julyReading());

    // If the model had read the wrong title, taking the photo again would
    // not help: it would read the same title again. The month must be correctable.
    // June has 30 days against July's 31, so the shift on the 31st (the last
    // of July's fifteen) no longer has a day to land on: fourteen remain.
    await userEvent.selectOptions(screen.getByLabelText(/Mese/i), '6');
    await userEvent.click(screen.getByRole('button', { name: /Salva 14 giorni/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0][0]).toEqual({ date: '2026-06-17', code: 'M' });
  });

  it('switching to a shorter month makes the extra days disappear', async () => {
    const { onSave } = await renderWith(julyReading());

    // July has 31 days, February 28: the 29th, 30th and 31st no longer exist.
    // Of July's fifteen shifts, the last three fall there.
    await userEvent.selectOptions(screen.getByLabelText(/Mese/i), '2');
    await userEvent.click(screen.getByRole('button', { name: /Salva 12 giorni/ }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toHaveLength(12);
  });

  // Regression: the confirmation names the month it saved. Changing the
  // month is the equivalent, on this screen, of editing BulkEntry's
  // textarea — it must go stale too, or it sits over a plan that now names
  // a different month than the one it actually saved.
  it('clears the save confirmation once a different month is picked', async () => {
    await renderWith(julyReading());

    await userEvent.click(await screen.findByRole('button', { name: /Salva 15 giorni/ }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Salvati 15 giorni di Luglio/);

    await userEvent.selectOptions(screen.getByLabelText(/Mese/i), '6');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  // Without the column labels, the offset that aligns day 1 to its weekday
  // reads as an unexplained hole at the top of the grid.
  it('labels the weekday columns, like the calendar', async () => {
    const { container } = await renderWith(julyReading());

    await waitFor(() => expect(container.querySelector('.photo-days')).toBeInTheDocument());
    const labels = [...container.querySelectorAll('.photo-days span')].map((s) => s.textContent);
    expect(labels).toEqual([...SHORT_DAY_NAMES]);
  });

  // Regression: a wrong offset direction, or dropping the `+ 1`, would put
  // every day in the wrong weekday column while the grid still looked
  // plausible. 1 July 2026 is a Wednesday: column 3 of 7 (Monday first).
  it('aligns the first day of the month to its weekday column', async () => {
    await renderWith(julyReading());

    const day1 = await screen.findByRole('button', { name: /^1 / });
    expect(day1).toHaveStyle({ gridColumnStart: '3' });
  });
});

/** Two other rows from the same July sheet, thirty-one codes each, matching
 *  `julyReading()`'s month. */
const ROSTER: MonthRoster = {
  year: 2026,
  month: 7,
  people: [
    { name: 'Giulia', row: 3, codes: Array<string>(31).fill('M') },
    { name: 'Marta', row: 4, codes: Array<string>(31).fill('P') },
  ],
};

describe('PhotoImport and the other rows', () => {
  it('says how many people it read, without listing them unasked', async () => {
    await renderWith(julyReading(), undefined, { second: secondFor(julyReading(), ROSTER.people) });
    expect(await screen.findByText(/lette 2 persone/i)).toBeInTheDocument();
    expect(screen.queryByText('Giulia')).not.toBeInTheDocument();
  });

  it('opens on request, so a row shifted or a name misread can be seen', async () => {
    await renderWith(julyReading(), undefined, { second: secondFor(julyReading(), ROSTER.people) });
    await userEvent.click(await screen.findByRole('button', { name: /lette 2 persone/i }));
    expect(screen.getByText('Giulia')).toBeInTheDocument();
    expect(screen.getByText('Marta')).toBeInTheDocument();
  });

  it('saves her shifts before the roster', async () => {
    const order: string[] = [];
    await renderWith(julyReading(), undefined, {
      second: secondFor(julyReading(), ROSTER.people),
      onSave: async () => {
        order.push('shifts');
      },
      onSaveRoster: async () => {
        order.push('roster');
      },
    });
    await salva();
    // The button's onClick doesn't hand the save promise back to
    // `userEvent.click`, so the click resolves before `save()` does: wait
    // for it to have run to completion, as the pre-existing tests in this
    // file wait on `onSave`, before asserting on the result.
    await waitFor(() => expect(order).toHaveLength(2));
    expect(order).toEqual(['shifts', 'roster']);
  });

  // Her import succeeded. Saying otherwise would send her back to redo work
  // that is already stored.
  it('reports a roster that failed without claiming the import failed', async () => {
    await renderWith(julyReading(), undefined, {
      second: secondFor(julyReading(), ROSTER.people),
      onSaveRoster: async () => {
        throw new Error('rete giù');
      },
    });
    await salva();
    expect(await screen.findByText(/turni sono salvati/i)).toBeInTheDocument();
    expect(screen.getByText(/rete giù/i)).toBeInTheDocument();
  });

  it('reshapes the roster when she corrects the month, so both are stored under one month', async () => {
    const saved: MonthRoster[] = [];
    await renderWith(julyReading(), undefined, {
      second: secondFor(julyReading(), ROSTER.people),
      onSaveRoster: async (r) => {
        saved.push(r);
      },
    });

    // June has 30 days against July's 31: the roster must reshape to match,
    // or it would end up stored under the corrected month with the wrong
    // number of days in it.
    await userEvent.selectOptions(screen.getByLabelText(/Mese/i), '6');
    await salva();

    // Same reason as the order test above: the click resolves before
    // `save()` finishes, so wait for the roster save to have landed.
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.month).toBe(6);
    expect(saved[0]!.people[0]!.codes).toHaveLength(30);
  });

  it('does not call the roster endpoint when nobody else was read', async () => {
    let called = 0;
    const { onSave } = await renderWith(julyReading(), undefined, {
      onSaveRoster: async () => {
        called += 1;
      },
    });
    await salva();
    // Wait for `save()` to have run its course, same as the tests above,
    // before trusting that the absence held rather than just being early.
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(called).toBe(0);
  });
});

describe('PhotoImport and the second reading', () => {
  const FAIL = 'Le colleghe non si sono lette questa volta. I tuoi turni non cambiano.';
  /** A promise the test settles when it wants: the second reading in flight. */
  function inFlight() {
    let settle!: (v: SecondRead) => void;
    const promise = new Promise<SecondRead>((r) => (settle = r));
    return { promise, settle };
  }

  it('starts by itself once her row is back, with the same image, and says so meanwhile', async () => {
    const pending = inFlight();
    const { onReadRoster } = await renderWith(julyReading(), undefined, { second: pending.promise });
    expect(await screen.findByText('Leggo anche le colleghe…')).toBeInTheDocument();
    expect(onReadRoster).toHaveBeenCalledTimes(1);
    expect(onReadRoster).toHaveBeenCalledWith('AAAA');
  });

  it('fills the roster block when it agrees with her row', async () => {
    await renderWith(julyReading(), undefined, { second: secondFor(julyReading(), ROSTER.people) });
    expect(await screen.findByText(/lette 2 persone/i)).toBeInTheDocument();
    expect(screen.queryByText('Leggo anche le colleghe…')).not.toBeInTheDocument();
  });

  it('shows the one failure line when her row was read one column off', async () => {
    const good = secondFor(julyReading(), ROSTER.people);
    const shifted: SecondRead = {
      ...good,
      rows: [{ ...good.rows[0]!, codes: ['', ...good.rows[0]!.codes.slice(0, 30)] }, ...good.rows.slice(1)],
    };
    await renderWith(julyReading(), undefined, { second: shifted });
    expect(await screen.findByText(FAIL)).toBeInTheDocument();
    expect(screen.queryByText(/lette 2 persone/i)).not.toBeInTheDocument();
  });

  it('shows the same line when the second reading fails outright', async () => {
    await renderWith(julyReading(), undefined, { second: new Error('Il servizio non risponde.') });
    expect(await screen.findByText(FAIL)).toBeInTheDocument();
  });

  it('lets her save while it is still reading, and saves no roster then', async () => {
    const pending = inFlight();
    const { onSave, onSaveRoster } = await renderWith(julyReading(), undefined, { second: pending.promise });
    await salva();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSaveRoster).not.toHaveBeenCalled();
  });

  // She saved while it was still reading and has no reason to come back: a
  // roster that arrives afterwards is saved by itself, or it never is.
  it('saves by itself a roster that arrives after her shifts were saved', async () => {
    const pending = inFlight();
    const { onSave, onSaveRoster } = await renderWith(julyReading(), undefined, { second: pending.promise });
    await salva();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    pending.settle(secondFor(julyReading(), ROSTER.people));
    await waitFor(() => expect(onSaveRoster).toHaveBeenCalledTimes(1));
    expect(onSaveRoster.mock.calls[0]![0].people).toHaveLength(2);
  });

  it('does not save a late roster by itself once she has changed the grid since saving', async () => {
    const pending = inFlight();
    const { onSave, onSaveRoster } = await renderWith(julyReading(), undefined, { second: pending.promise });
    await salva();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await userEvent.selectOptions(screen.getByLabelText(/Mese/i), '6');
    pending.settle(secondFor(julyReading(), ROSTER.people));
    expect(await screen.findByText(/lette 2 persone/i)).toBeInTheDocument();
    expect(onSaveRoster).not.toHaveBeenCalled();
  });

  it('stores a late roster under the month she picked meanwhile', async () => {
    const pending = inFlight();
    const { onSaveRoster } = await renderWith(julyReading(), undefined, { second: pending.promise });
    await userEvent.selectOptions(screen.getByLabelText(/Mese/i), '6');
    pending.settle(secondFor(julyReading(), ROSTER.people));
    expect(await screen.findByText(/lette 2 persone/i)).toBeInTheDocument();
    await salva();
    await waitFor(() => expect(onSaveRoster).toHaveBeenCalledTimes(1));
    expect(onSaveRoster.mock.calls[0]![0].month).toBe(6);
    expect(onSaveRoster.mock.calls[0]![0].people[0]!.codes).toHaveLength(30);
  });

  // The race that matters: photo A's second reading lands after photo B's
  // first reading is already on screen. Without the guard A's roster — read
  // from another sheet — would attach to B's grid.
  it("does not attach an old photo's late roster to the new photo", async () => {
    const a = inFlight();
    const b = inFlight();
    const onReadRoster = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    render(
      <PhotoImport
        year={2026}
        existing={new Map()}
        onRead={vi.fn().mockResolvedValue({
          reading: julyReading(),
          roster: { year: 2026, month: 7, people: [] },
        })}
        onReadRoster={onReadRoster}
        onSave={async () => {}}
        onSaveRoster={async () => {}}
      />,
    );
    const foto = () => new File(['finta'], 'foglio.jpeg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText(/Leggi da una foto/i), foto());
    await userEvent.click(await screen.findByRole('button', { name: /ripeti con un altra foto/i }));
    await userEvent.upload(screen.getByLabelText(/Leggi da una foto/i), foto());
    await waitFor(() => expect(onReadRoster).toHaveBeenCalledTimes(2));

    a.settle(secondFor(julyReading(), ROSTER.people));
    // Give the late answer every chance to land before asserting it did not.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/lette 2 persone/i)).not.toBeInTheDocument();
    expect(screen.getByText('Leggo anche le colleghe…')).toBeInTheDocument();
  });
});
