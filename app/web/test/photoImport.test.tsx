import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MonthRoster, PhotoReading, IsoDate, ShiftCode } from '@vanessa/core';
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

/** Extra behaviour beyond the reading itself: a roster to hand back from
 *  `onRead`, and custom `onSave`/`onSaveRoster` implementations for tests
 *  that need to observe order or failure rather than just success. */
interface RenderOverrides {
  roster?: MonthRoster;
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
  // Empty by default: most tests here only exercise her own row, and an
  // empty roster is exactly what a handler unaware of rosters would send.
  const roster = overrides.roster ?? { year: reading.year, month: reading.month, people: [] };
  const onRead = vi.fn().mockResolvedValue({ reading, roster });
  const { container } = render(
    <PhotoImport
      year={2026}
      existing={existing}
      onRead={onRead}
      onSave={onSave}
      onSaveRoster={onSaveRoster}
    />,
  );

  await userEvent.upload(
    screen.getByLabelText(/Leggi da una foto/i),
    new File(['finta'], 'foglio.jpeg', { type: 'image/jpeg' }),
  );
  return { onSave, onSaveRoster, onRead, container };
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
    await renderWith(julyReading(), undefined, { roster: ROSTER });
    expect(await screen.findByText(/lette 2 persone/i)).toBeInTheDocument();
    expect(screen.queryByText('Giulia')).not.toBeInTheDocument();
  });

  it('opens on request, so a row shifted or a name misread can be seen', async () => {
    await renderWith(julyReading(), undefined, { roster: ROSTER });
    await userEvent.click(await screen.findByRole('button', { name: /lette 2 persone/i }));
    expect(screen.getByText('Giulia')).toBeInTheDocument();
    expect(screen.getByText('Marta')).toBeInTheDocument();
  });

  it('saves her shifts before the roster', async () => {
    const order: string[] = [];
    await renderWith(julyReading(), undefined, {
      roster: ROSTER,
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
      roster: ROSTER,
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
      roster: ROSTER,
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
