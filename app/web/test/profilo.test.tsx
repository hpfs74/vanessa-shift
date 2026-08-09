import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_PAY_SETTINGS, EMPTY_PROFILE } from '@vanessa/core';

import { Profilo } from '../src/Profilo.js';
import type { Api } from '../src/api.js';

function fakeApi(over: Partial<Api> = {}): Api {
  return {
    config: async () => ({
      pay: EMPTY_PAY_SETTINGS,
      profile: EMPTY_PROFILE,
      quota: { used: 0 },
    }),
    saveProfile: async () => {},
    ...over,
  } as unknown as Api;
}

describe('Profilo', () => {
  it('shows the profile once it has loaded', async () => {
    const api = fakeApi({
      config: async () => ({
        pay: EMPTY_PAY_SETTINGS,
        profile: { ...EMPTY_PROFILE, firstName: 'Vanessa', ccnlLevel: 'C1' },
        quota: { used: 0 },
      }),
    });
    render(<Profilo api={api} onClose={() => {}} />);
    expect(await screen.findByDisplayValue('Vanessa')).toBeInTheDocument();
    expect(screen.getByDisplayValue('C1')).toBeInTheDocument();
  });

  it('shows an unset profile as empty fields, not as an error', async () => {
    render(<Profilo api={fakeApi()} onClose={() => {}} />);
    await screen.findByLabelText('Nome');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nome')).toHaveValue('');
  });

  it('reports the readings spent out of the shared maximum', async () => {
    const api = fakeApi({
      config: async () => ({
        pay: EMPTY_PAY_SETTINGS,
        profile: EMPTY_PROFILE,
        quota: { used: 3 },
      }),
    });
    render(<Profilo api={api} onClose={() => {}} />);
    expect(await screen.findByText(/3 di 10/)).toBeInTheDocument();
  });

  it('saves what was typed', async () => {
    const saveProfile = vi.fn<Api['saveProfile']>(async () => {});
    render(<Profilo api={fakeApi({ saveProfile })} onClose={() => {}} />);
    await userEvent.type(await screen.findByLabelText('Nome'), 'Vanessa');
    await userEvent.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() => expect(saveProfile).toHaveBeenCalled());
    expect(saveProfile.mock.calls[0]![0]).toMatchObject({ firstName: 'Vanessa' });
  });

  it('keeps what she typed when the save fails', async () => {
    // Losing the text on a failed write would make retrying pointless.
    const saveProfile = vi.fn(async () => {
      throw new Error('richiesta fallita (500)');
    });
    render(<Profilo api={fakeApi({ saveProfile })} onClose={() => {}} />);
    await userEvent.type(await screen.findByLabelText('Nome'), 'Vanessa');
    await userEvent.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('richiesta fallita (500)');
    expect(screen.getByLabelText('Nome')).toHaveValue('Vanessa');
  });

  it('shows the error and stays usable when loading fails', async () => {
    const api = fakeApi({
      config: async () => {
        throw new Error('richiesta fallita (500)');
      },
    });
    render(<Profilo api={api} onClose={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('richiesta fallita (500)');
    expect(screen.getByRole('button', { name: 'Indietro' })).toBeInTheDocument();
  });

  it('goes back when asked', async () => {
    const onClose = vi.fn();
    render(<Profilo api={fakeApi()} onClose={onClose} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Indietro' }));
    expect(onClose).toHaveBeenCalled();
  });
});
