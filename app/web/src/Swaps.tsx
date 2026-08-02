/** Swap balances per colleague. Mirrors the Scambi sheet. */

import { type DayRecord, SWAP_KINDS, swapReport } from '@vanessa/core';

export interface SwapsProps {
  days: readonly DayRecord[];
}

export function Swaps({ days }: SwapsProps) {
  const report = swapReport(days);

  if (report.balances.length === 0) {
    return (
      <section className="swaps">
        <h2>Scambi</h2>
        <p className="note">
          Non c'è ancora nessuno scambio. Aprendo un giorno del calendario puoi
          segnare con chi hai scambiato il turno e in che modo.
        </p>
      </section>
    );
  }

  return (
    <section className="swaps">
      <h2>Scambi</h2>
      <p className="note">
        Saldo favori positivo = lei deve un favore a te. Saldo ore positivo = hai
        lavorato più ore di quelle che ti spettavano.
      </p>

      <ul className="cards">
        {report.balances.map((b) => (
          <li key={b.colleague} className="card">
            <div className="card-head">
              <strong>{b.colleague}</strong>
              <span className={b.favourBalance > 0 ? 'good' : b.favourBalance < 0 ? 'bad' : ''}>
                {b.favourBalance > 0 ? `+${b.favourBalance}` : b.favourBalance} favori
              </span>
            </div>
            <dl>
              {SWAP_KINDS.map((k) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{b.counts[k]}</dd>
                </div>
              ))}
              <div>
                <dt>Saldo ore</dt>
                <dd className={b.hoursBalance > 0 ? 'good' : b.hoursBalance < 0 ? 'bad' : ''}>
                  {b.hoursBalance > 0 ? `+${b.hoursBalance}` : b.hoursBalance}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      {report.unattributed > 0 && (
        <p className="error" role="alert">
          {report.unattributed} scambi non hanno il nome della collega: non entrano in
          nessun saldo. Aprili dal calendario e aggiungi il nome.
        </p>
      )}
    </section>
  );
}
