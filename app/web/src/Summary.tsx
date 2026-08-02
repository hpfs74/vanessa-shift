/** Monthly counts, worked days and hours. Mirrors the Riepilogo sheet.
 *
 * The bars are plain CSS: a chart library would be far more bytes than the
 * whole app for something a width percentage already says.
 */

import type { DayEntry, IsoDate, ShiftCode } from '@vanessa/core';
import {
  MONTH_NAMES,
  SHIFTS,
  WORKED_SHIFTS,
  hoursPerCode,
  summaryTotals,
  yearSummary,
} from '@vanessa/core';

import { Donut } from './Donut.js';

/* Slice colours.
 *
 * NOT the pastel tints the calendar cells use: those are backgrounds behind a
 * visible code letter, and as slices they are indistinguishable — the
 * validator rates the worst pair at ΔE 4.9 for normal vision, i.e. unreadable
 * even without any colour deficiency.
 *
 * These four pass every check for the light surface, compared across ALL
 * pairs and not merely adjacent ones, because in a ring every slice borders
 * every other. Yellow had to go: against orange it sits at ΔE 13.7, under the
 * floor of 15.
 *
 * The app declares `color-scheme: light` and has no dark theme. If one is ever
 * added these values must be re-stepped for the dark surface and validated
 * again — a straight flip does not survive the check.
 */
const SLICE_COLOUR: Record<ShiftCode, string> = {
  M: '#2a78d6',
  M1: '#eb6834',
  P: '#1baf7a',
  P1: '#4a3aa7',
  // Libero is the absence of work, so it wears the conventional neutral
  // rather than a fifth identity hue.
  L: '#8a95a1',
};

export interface SummaryProps {
  year: number;
  shifts: ReadonlyMap<IsoDate, DayEntry>;
}

export function Summary({ year, shifts }: SummaryProps) {
  const months = yearSummary(year, shifts);
  const totals = summaryTotals(months);
  const peak = Math.max(1, ...months.map((m) => m.totalHours));
  const perCode = hoursPerCode(year, shifts);

  return (
    <section className="summary">
      <h2>Riepilogo {year}</h2>

      <p className="summary-line">
        <strong>{totals.totalHours} ore</strong> · {totals.workedDays} giorni lavorati
      </p>

      <div className="donuts">
        <Donut
          title="Ore per turno"
          unit="ore"
          emptyText="Nessuna ora registrata quest'anno."
          slices={WORKED_SHIFTS.map((sh) => ({
            key: sh.code,
            label: sh.code,
            description: sh.description,
            value: perCode[sh.code],
            colour: SLICE_COLOUR[sh.code],
          }))}
        />
        <Donut
          title="Giorni per codice"
          unit="giorni"
          emptyText="Nessun giorno registrato quest'anno."
          slices={SHIFTS.map((sh) => ({
            key: sh.code,
            label: sh.code,
            description: sh.description,
            value: totals.perCode[sh.code],
            colour: SLICE_COLOUR[sh.code],
          }))}
        />
      </div>

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
