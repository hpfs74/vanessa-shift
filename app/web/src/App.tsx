/** Visible text stays in Italian: Vanessa reads it. */

import { useCallback, useEffect, useState } from 'react';

import type { IsoDate, PaySettings, ShiftCode } from '@vanessa/core';
import { EMPTY_PAY_SETTINGS, MONTH_NAMES, SHIFTS } from '@vanessa/core';

import { Calendar } from './Calendar.js';
import { Pay } from './Pay.js';
import { api as realApi, type Api } from './api.js';

const YEAR = 2026;

export interface AppProps {
  api?: Api;
  initialMonth?: number;
}

export function App({ api = realApi, initialMonth = 1 }: AppProps) {
  const [month, setMonth] = useState(initialMonth);
  const [view, setView] = useState<'calendar' | 'pay'>('calendar');
  const [shifts, setShifts] = useState<Map<IsoDate, ShiftCode>>(new Map());
  const [settings, setSettings] = useState<PaySettings>(EMPTY_PAY_SETTINGS);
  const [selected, setSelected] = useState<IsoDate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([api.shifts(`${YEAR}-01-01`, `${YEAR}-12-31`), api.paySettings()])
      .then(([s, p]) => {
        if (!alive) return;
        setShifts(new Map(s.map((x) => [x.date, x.code])));
        setSettings(p);
        setError(null);
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [api]);

  /** Optimistic: the cell changes at once, and rolls back if the network says no. */
  const pickCode = useCallback(
    async (d: IsoDate, code: ShiftCode | null) => {
      const previous = shifts.get(d) ?? null;
      setShifts((m) => {
        const next = new Map(m);
        if (code) next.set(d, code);
        else next.delete(d);
        return next;
      });
      setSelected(null);
      try {
        await api.saveShift(d, code);
        setError(null);
      } catch (e) {
        setShifts((m) => {
          const next = new Map(m);
          if (previous) next.set(d, previous);
          else next.delete(d);
          return next;
        });
        setError((e as Error).message);
      }
    },
    [api, shifts],
  );

  const changeSettings = useCallback(
    (p: PaySettings) => {
      setSettings(p);
      api.savePaySettings(p).catch((e: Error) => setError(e.message));
    },
    [api],
  );

  return (
    <div className="app">
      <header>
        <h1>Turni di Vanessa</h1>
        <nav aria-label="Viste">
          <button
            type="button"
            aria-current={view === 'calendar'}
            onClick={() => setView('calendar')}
          >
            Calendario
          </button>
          <button type="button" aria-current={view === 'pay'} onClick={() => setView('pay')}>
            Stipendio
          </button>
        </nav>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {view === 'calendar' && (
        <>
          <div className="month-nav">
            <button
              type="button"
              aria-label="Mese precedente"
              disabled={month === 1}
              onClick={() => setMonth((m) => Math.max(1, m - 1))}
            >
              ‹
            </button>
            <h2>
              {MONTH_NAMES[month - 1]} {YEAR}
            </h2>
            <button
              type="button"
              aria-label="Mese successivo"
              disabled={month === 12}
              onClick={() => setMonth((m) => Math.min(12, m + 1))}
            >
              ›
            </button>
          </div>

          {loading ? (
            <p className="waiting">Carico i turni…</p>
          ) : (
            <Calendar
              year={YEAR}
              month={month}
              shifts={shifts}
              selected={selected}
              onPick={setSelected}
            />
          )}
        </>
      )}

      {view === 'pay' && (
        <Pay year={YEAR} shifts={shifts} settings={settings} onChange={changeSettings} />
      )}

      {selected && (
        <div className="picker" role="dialog" aria-label={`Turno del ${selected}`}>
          <p>{selected}</p>
          <div className="codes">
            {SHIFTS.map((s) => (
              <button
                key={s.code}
                type="button"
                className={`t-${s.code}`}
                onClick={() => void pickCode(selected, s.code)}
              >
                <strong>{s.code}</strong>
                <span>{s.description}</span>
              </button>
            ))}
            <button type="button" onClick={() => void pickCode(selected, null)}>
              <strong>×</strong>
              <span>Cancella</span>
            </button>
          </div>
          <button type="button" className="close" onClick={() => setSelected(null)}>
            Chiudi
          </button>
        </div>
      )}
    </div>
  );
}
