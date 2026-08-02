/** Monthly counts, worked days and hours. Mirrors the Riepilogo sheet.
 *
 * The bars are plain CSS: a chart library would be far more bytes than the
 * whole app for something a width percentage already says.
 */

import type { DayEntry, IsoDate } from '@vanessa/core';
import { MONTH_NAMES, SHIFTS, summaryTotals, yearSummary } from '@vanessa/core';

export interface SummaryProps {
  year: number;
  shifts: ReadonlyMap<IsoDate, DayEntry>;
}

export function Summary({ year, shifts }: SummaryProps) {
  const months = yearSummary(year, shifts);
  const totals = summaryTotals(months);
  const peak = Math.max(1, ...months.map((m) => m.totalHours));

  return (
    <section className="summary">
      <h2>Riepilogo {year}</h2>

      <p className="summary-line">
        <strong>{totals.totalHours} ore</strong> · {totals.workedDays} giorni lavorati
      </p>

      <h3>Ore per mese</h3>
      <ul className="bars">
        {months.map((m) => (
          <li key={m.month}>
            <span className="bar-label">{MONTH_NAMES[m.month - 1]!.slice(0, 3)}</span>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{ width: `${(m.totalHours / peak) * 100}%` }}
                role="img"
                aria-label={`${m.totalHours} ore`}
              />
            </span>
            <span className="bar-value">{m.totalHours || ''}</span>
          </li>
        ))}
      </ul>

      <h3>Turni per codice</h3>
      <div className="scroll-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Mese</th>
              {SHIFTS.map((s) => (
                <th key={s.code} scope="col">
                  {s.code}
                </th>
              ))}
              <th scope="col">Gg</th>
              <th scope="col">Ore</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month}>
                <th scope="row">{MONTH_NAMES[m.month - 1]!.slice(0, 3)}</th>
                {SHIFTS.map((s) => (
                  <td key={s.code}>{m.perCode[s.code] || ''}</td>
                ))}
                <td>{m.workedDays || ''}</td>
                <td>{m.totalHours || ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Anno</th>
              {SHIFTS.map((s) => (
                <td key={s.code}>{totals.perCode[s.code] || ''}</td>
              ))}
              <td>{totals.workedDays || ''}</td>
              <td>{totals.totalHours || ''}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
