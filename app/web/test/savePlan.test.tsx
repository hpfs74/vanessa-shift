import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { IsoDate, ShiftCode } from '@vanessa/core';

import { BulkEntry } from '../src/BulkEntry.js';

/** month is a controlled prop on BulkEntry (App owns it), so exercising the
 *  month-change trigger needs something that actually reacts to
 *  onMonthChange — a real caller, in miniature. */
function Harness() {
  const [month, setMonth] = useState(1);
  const existing = new Map<IsoDate, ShiftCode>();
  return (
    <BulkEntry
      year={2026}
      month={month}
      onMonthChange={setMonth}
      existing={existing}
      onSave={async () => {}}
      onReadPhoto={() => Promise.reject(new Error('not used in this test'))}
    />
  );
}

/** Regression tests for the seam between BulkEntry and SavePlan: the "saved"
 *  confirmation names the month it saved, so it must go stale on *any* input
 *  that changes what would be saved next — editing the sequence, or picking
 *  a different month — but must not be cleared by BulkEntry's own
 *  post-save textarea reset. A test on SavePlan alone would not see this —
 *  the bug lived in who owns the reset trigger, not in SavePlan itself. */
describe('BulkEntry save confirmation', () => {
  const noop = () => {};

  it('shows the confirmation after saving, then clears it once the sequence is edited again', async () => {
    const user = userEvent.setup();
    const existing = new Map<IsoDate, ShiftCode>();
    const onSave = async () => {};

    render(
      <BulkEntry
        year={2026}
        month={1}
        onMonthChange={noop}
        existing={existing}
        onSave={onSave}
        onReadPhoto={() => Promise.reject(new Error('not used in this test'))}
      />,
    );

    await user.type(screen.getByLabelText(/Sequenza/), 'M M P1 L');
    await user.click(screen.getByRole('button', { name: /Salva 4 giorni/ }));

    expect(await screen.findByRole('status')).toHaveTextContent(/Salvati 4 giorni di Gennaio/);

    await user.type(screen.getByLabelText(/Sequenza/), 'M');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the confirmation after saving, then clears it once a different month is picked', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    await user.type(screen.getByLabelText(/Sequenza/), 'M M P1 L');
    await user.click(screen.getByRole('button', { name: /Salva 4 giorni/ }));

    expect(await screen.findByRole('status')).toHaveTextContent(/Salvati 4 giorni di Gennaio/);

    await user.selectOptions(screen.getByLabelText(/Mese/), '2');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
