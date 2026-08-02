import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { IsoDate, ShiftCode } from '@vanessa/core';

import { BulkEntry } from '../src/BulkEntry.js';

/** Regression test for the seam between BulkEntry and SavePlan: the "saved"
 *  confirmation must go stale when the user edits the sequence again, but
 *  must not be cleared by BulkEntry's own post-save textarea reset. A test
 *  on SavePlan alone would not see this — the bug lived in who owns the
 *  reset trigger. */
describe('BulkEntry save confirmation', () => {
  const noop = () => {};

  it('shows the confirmation after saving, then clears it once the sequence is edited again', async () => {
    const user = userEvent.setup();
    const existing = new Map<IsoDate, ShiftCode>();
    const onSave = async () => {};

    render(
      <BulkEntry year={2026} month={1} onMonthChange={noop} existing={existing} onSave={onSave} />,
    );

    await user.type(screen.getByLabelText(/Sequenza/), 'M M P1 L');
    await user.click(screen.getByRole('button', { name: /Salva 4 giorni/ }));

    expect(await screen.findByRole('status')).toHaveTextContent(/Salvati 4 giorni di Gennaio/);

    await user.type(screen.getByLabelText(/Sequenza/), 'M');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
