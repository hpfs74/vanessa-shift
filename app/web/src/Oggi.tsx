/** The first screen: a welcome, and the next five days.
 *
 * The question she opens the app with is short — "what am I on tomorrow, and
 * who is with me" — and the month grid answers it only after a search. This
 * answers it at a glance, from data already stored: her shifts, which `App`
 * loads for the whole year, and the colleagues' roster of each month the five
 * days touch.
 */

import { useEffect, useMemo, useState } from 'react';

import type { IsoDate, MonthRoster } from '@vanessa/core';
import {
  DAY_NAMES,
  MONTH_NAMES,
  ROW_NAME,
  isShiftCode,
  nextDays,
  parseIso,
  rosterOnDay,
  shift,
  weekday,
} from '@vanessa/core';

import type { Api, RemoteShift } from './api.js';

const HOW_MANY = 5;

export interface OggiProps {
  today: IsoDate;
  /** The year the app covers: no roster is asked for outside it. */
  year: number;
  days: ReadonlyMap<IsoDate, RemoteShift>;
  api: Pick<Api, 'roster'>;
}

const monthKey = (year: number, month: number) => `${year}-${month}`;

/** «lunedì 16 novembre» */
function longDate(d: IsoDate): string {
  const { month, day } = parseIso(d);
  return `${DAY_NAMES[weekday(d)]} ${day} ${MONTH_NAMES[month - 1]!.toLowerCase()}`;
}

/** A code that is a shift she works: the colleagues only matter on those. */
const worked = (code: string) => isShiftCode(code) && shift(code).hours > 0;

export function Oggi({ today, year, days, api }: OggiProps) {
  const dates = useMemo(() => nextDays(today, HOW_MANY), [today]);

  // The months the five days touch, one or two, inside the year the app
  // covers. A roster for another year would never have been stored.
  const months = useMemo(() => {
    const seen = new Map<string, { year: number; month: number }>();
    for (const d of dates) {
      const p = parseIso(d);
      if (p.year === year) seen.set(monthKey(p.year, p.month), { year: p.year, month: p.month });
    }
    return [...seen.values()];
  }, [dates, year]);

  // Absent while loading; null once known to be missing. A roster that will
  // not load reads as one never read: nothing here is worth an error.
  const [rosters, setRosters] = useState<ReadonlyMap<string, MonthRoster | null>>(new Map());

  useEffect(() => {
    let alive = true;
    for (const m of months) {
      api
        .roster(m.year, m.month)
        .catch(() => null)
        .then((r) => {
          if (alive) setRosters((prev) => new Map(prev).set(monthKey(m.year, m.month), r));
        });
    }
    return () => {
      alive = false;
    };
  }, [api, months]);

  const unread = months.filter((m) => rosters.get(monthKey(m.year, m.month)) === null);

  return (
    <section className="oggi">
      <h2>Ciao {ROW_NAME}</h2>
      <p className="oggi-data">{longDate(today)}</p>

      {dates.map((d, i) => {
        const label = (i === 0 ? 'Oggi, ' : i === 1 ? 'Domani, ' : '') + longDate(d);
        const code = days.get(d)?.code;
        const p = parseIso(d);
        const roster = rosters.get(monthKey(p.year, p.month)) ?? null;
        const present =
          code && worked(code) ? rosterOnDay(roster, d, code).filter((e) => worked(e.code)) : [];
        const withYou = present.filter((e) => e.withYou);
        const others = present.filter((e) => !e.withYou);
        const list = (es: typeof present) => es.map((e) => `${e.name} (${e.code})`).join(', ');

        return (
          <article key={d} className="oggi-giorno" aria-label={label}>
            <h3>{label}</h3>
            {!code ? (
              <p className="hint">Nessun turno inserito</p>
            ) : (
              <p className="oggi-turno">
                <span className={`oggi-codice t-${code}`}>{code}</span>
                {shift(code).hours === 0 ? (
                  <span>{shift(code).description}</span>
                ) : (
                  <span>
                    {shift(code).description} · {shift(code).start}–{shift(code).end}
                  </span>
                )}
              </p>
            )}
            {withYou.length > 0 && <p className="oggi-con-te">Con te: {list(withYou)}</p>}
            {others.length > 0 && <p className="hint">In reparto anche: {list(others)}</p>}
          </article>
        );
      })}

      {unread.map((m) => (
        <p key={monthKey(m.year, m.month)} className="hint">
          Le colleghe di {MONTH_NAMES[m.month - 1]!.toLowerCase()} non sono ancora state lette.
        </p>
      ))}
    </section>
  );
}
