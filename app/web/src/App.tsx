/** Mobile first: bottom navigation, thumb-sized targets, bottom sheets.
 *  Visible text stays in Italian: Vanessa reads it. */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { DayEntry, DayRecord, IsoDate, PaySettings, ShiftCode } from '@vanessa/core';
import {
  EMPTY_PAY_SETTINGS,
  MONTH_NAMES,
  knownColleagues,
  parseIso,
  today as realToday,
} from '@vanessa/core';

import { BulkEntry } from './BulkEntry.js';
import { Calendar } from './Calendar.js';
import { DayEditor } from './DayEditor.js';
import { Pay } from './Pay.js';
import { Summary } from './Summary.js';
import { Swaps } from './Swaps.js';
import type { Sessione } from './auth.js';
import { api as realApi, type Api, type RemoteShift } from './api.js';

const YEAR = 2026;

type View = 'calendar' | 'bulk' | 'swaps' | 'summary' | 'pay';

const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: 'calendar', label: 'Calendario', icon: '▦' },
  { id: 'bulk', label: 'Carica', icon: '⇥' },
  { id: 'swaps', label: 'Scambi', icon: '⇄' },
  { id: 'summary', label: 'Riepilogo', icon: '≡' },
  { id: 'pay', label: 'Stipendio', icon: '€' },
];

export interface AppProps {
  api?: Api;
  initialMonth?: number;
  initialView?: View;
  /** Injected so tests do not depend on the day they are run. */
  today?: IsoDate;
  /** The gate in main.tsx has already checked it is good: App itself does
   *  nothing with it beyond receiving it. */
  sessione?: Sessione;
}

export function App({
  api = realApi,
  initialMonth,
  initialView = 'calendar',
  today = realToday(),
}: AppProps) {
  // Open on the month you are living in. In another year the rota does not
  // cover, January is the only honest default.
  const todayParts = parseIso(today);
  const [month, setMonth] = useState(
    initialMonth ?? (todayParts.year === YEAR ? todayParts.month : 1),
  );
  const [view, setView] = useState<View>(initialView);
  const [days, setDays] = useState<Map<IsoDate, RemoteShift>>(new Map());
  const [settings, setSettings] = useState<PaySettings>(EMPTY_PAY_SETTINGS);
  const [editing, setEditing] = useState<IsoDate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [s, p] = await Promise.all([
      api.shifts(`${YEAR}-01-01`, `${YEAR}-12-31`),
      api.paySettings(),
    ]);
    setDays(new Map(s.map((x) => [x.date, x])));
    setSettings(p);
  }, [api]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    reload()
      .then(() => alive && setError(null))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reload]);

  // The views want the day as stored, not just its code: the hour override
  // has to reach the calendar, the summary and the pay simulation alike.
  const entries = useMemo(() => {
    const m = new Map<IsoDate, DayEntry>();
    for (const [date, s] of days) {
      m.set(date, { code: s.code, hoursOverride: s.hoursOverride ?? null });
    }
    return m;
  }, [days]);

  /** The bulk screen only ever sets codes, so it compares codes. */
  const codes = useMemo(() => {
    const m = new Map<IsoDate, ShiftCode>();
    for (const [date, s] of days) m.set(date, s.code);
    return m;
  }, [days]);

  const records = useMemo<DayRecord[]>(() => [...days.values()], [days]);
  const colleagues = useMemo(() => knownColleagues(records), [records]);

  /** Optimistic: the cell changes at once, and rolls back if the network says no. */
  const saveDay = useCallback(
    async (shift: RemoteShift) => {
      const previous = days.get(shift.date) ?? null;
      setDays((m) => new Map(m).set(shift.date, shift));
      setEditing(null);
      try {
        await api.saveShift(shift);
        setError(null);
      } catch (e) {
        setDays((m) => {
          const next = new Map(m);
          if (previous) next.set(shift.date, previous);
          else next.delete(shift.date);
          return next;
        });
        setError((e as Error).message);
      }
    },
    [api, days],
  );

  const deleteDay = useCallback(
    async (date: IsoDate) => {
      const previous = days.get(date) ?? null;
      setDays((m) => {
        const next = new Map(m);
        next.delete(date);
        return next;
      });
      setEditing(null);
      try {
        await api.deleteShift(date);
        setError(null);
      } catch (e) {
        setDays((m) => (previous ? new Map(m).set(date, previous) : m));
        setError((e as Error).message);
      }
    },
    [api, days],
  );

  const saveBulk = useCallback(
    async (entries: readonly { date: IsoDate; code: ShiftCode }[]) => {
      try {
        await api.saveShifts(entries);
        await reload();
        setError(null);
      } catch (e) {
        setError((e as Error).message);
        throw e;
      }
    },
    [api, reload],
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
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <main>
        {/* Finche' i dati non sono arrivati nessuna vista puo' dire la verita':
            un riepilogo a zero durante il caricamento sembra un anno vuoto,
            non un anno non ancora letto. Vale per tutte le viste, non solo
            per il calendario. */}
        {loading && <p className="waiting">Carico i turni…</p>}

        {!loading && view === 'calendar' && (
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

            <Calendar
              year={YEAR}
              month={month}
              shifts={entries}
              swapped={new Set(records.filter((r) => r.originalCode).map((r) => r.date))}
              today={today}
              selected={editing}
              onPick={setEditing}
            />
          </>
        )}

        {!loading && view === 'bulk' && (
          <BulkEntry
            year={YEAR}
            month={month}
            onMonthChange={setMonth}
            existing={codes}
            onSave={saveBulk}
            onReadPhoto={api.readPhoto}
          />
        )}

        {!loading && view === 'swaps' && <Swaps days={records} />}
        {!loading && view === 'summary' && <Summary year={YEAR} shifts={entries} />}
        {!loading && view === 'pay' && (
          <Pay year={YEAR} shifts={entries} settings={settings} onChange={changeSettings} />
        )}
      </main>

      {editing && (
        <DayEditor
          date={editing}
          shift={days.get(editing) ?? null}
          colleagues={colleagues}
          onSave={(s) => void saveDay(s)}
          onDelete={() => void deleteDay(editing)}
          onClose={() => setEditing(null)}
        />
      )}

      <nav className="tabbar" aria-label="Sezioni">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-current={view === v.id}
            onClick={() => {
              setView(v.id);
              setEditing(null);
            }}
          >
            <span aria-hidden="true">{v.icon}</span>
            {v.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
