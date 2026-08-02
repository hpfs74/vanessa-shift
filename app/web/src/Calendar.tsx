/** The monthly calendar: same layout as the spreadsheet, Monday to Sunday. */

import type { IsoDate, ShiftCode } from '@vanessa/core';
import {
  MONTH_NAMES,
  SHORT_DAY_NAMES,
  dayKind,
  hours,
  italianHolidays,
  monthDays,
  monthHours,
  timeRange,
  weekday,
} from '@vanessa/core';

export interface CalendarProps {
  year: number;
  month: number;
  shifts: ReadonlyMap<IsoDate, ShiftCode>;
  /** Days that were swapped with a colleague: marked with a dot. */
  swapped?: ReadonlySet<IsoDate>;
  /** Today, so it can be picked out of the grid. Injected to keep tests fixed. */
  today?: IsoDate;
  selected: IsoDate | null;
  onPick: (d: IsoDate) => void;
}

/** The weeks of the month, with `null` in the cells belonging to neighbours. */
export function weeksOfMonth(year: number, month: number): (IsoDate | null)[][] {
  const days = monthDays(year, month);
  const first = days[0]!;
  const cells: (IsoDate | null)[] = Array<IsoDate | null>(weekday(first)).fill(null);
  cells.push(...days);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (IsoDate | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function weekHours(
  week: readonly (IsoDate | null)[],
  shifts: ReadonlyMap<IsoDate, ShiftCode>,
): number {
  return week.reduce<number>((acc, d) => acc + (d ? hours(shifts.get(d)) : 0), 0);
}

export function Calendar({
  year,
  month,
  shifts,
  swapped,
  today,
  selected,
  onPick,
}: CalendarProps) {
  const holidays = italianHolidays(year);
  const weeks = weeksOfMonth(year, month);
  const totals = monthHours(year, month, shifts);
  const workedDays = monthDays(year, month).filter((d) => hours(shifts.get(d)) > 0).length;

  return (
    <section className="calendar" aria-label={`${MONTH_NAMES[month - 1]} ${year}`}>
      <div className="grid header-row" role="row">
        {SHORT_DAY_NAMES.map((d) => (
          <div key={d} className="header-cell" role="columnheader">
            {d}
          </div>
        ))}
        <div className="header-cell hours" role="columnheader">
          Ore
        </div>
      </div>

      {weeks.map((week, i) => (
        <div className="grid" role="row" key={i}>
          {week.map((d, j) => {
            if (!d) return <div key={j} className="day empty" aria-hidden="true" />;
            const code = shifts.get(d);
            const kind = dayKind(d, holidays);
            const dayNumber = Number(d.slice(8));
            const holidayName = holidays.get(d);
            return (
              <button
                key={j}
                type="button"
                className={[
                  'day',
                  `d-${kind}`,
                  code ? `t-${code}` : '',
                  d === today ? 'is-today' : '',
                  selected === d ? 'selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-pressed={selected === d}
                aria-label={
                  `${dayNumber} ${MONTH_NAMES[month - 1]}` +
                  (holidayName ? `, ${holidayName}` : '') +
                  (d === today ? ', oggi' : '') +
                  (code ? `, turno ${code}` : ', nessun turno') +
                  (swapped?.has(d) ? ', scambiato' : '')
                }
                onClick={() => onPick(d)}
              >
                <span className="day-number">{dayNumber}</span>
                <span className="code">
                  {code ?? ''}
                  {swapped?.has(d) ? <i className="swap-dot" aria-hidden="true" /> : null}
                </span>
                <span className="time">{code ? timeRange(code) : ''}</span>
              </button>
            );
          })}
          <div className="day week-hours">{weekHours(week, shifts) || ''}</div>
        </div>
      ))}

      <p className="month-total">
        <strong>{totals.total}</strong> ore · {workedDays} giorni lavorati
      </p>
    </section>
  );
}
