/** Import from a photo of the sheet.
 *
 * The grid is editable in full, not only where the model declared itself
 * unsure: the typical mistake in a reading is a single cell, and whoever
 * spots it wrong must be able to correct it even when the model was
 * convinced of the opposite.
 */

import { useMemo, useRef, useState } from 'react';

import type { MonthRoster, PhotoReading, IsoDate, SecondRead, ShiftCode } from '@vanessa/core';
import type { PhotoRead } from './api.js';
import {
  MONTH_NAMES,
  SHIFTS,
  SHORT_DAY_NAMES,
  daysInMonth,
  entriesFromReading,
  reshapeRoster,
  rosterFromSecondRead,
  toIso,
  weekday,
} from '@vanessa/core';

import { SavePlan } from './SavePlan.js';
import { resize } from './image.js';

export interface PhotoImportProps {
  year: number;
  existing: ReadonlyMap<IsoDate, ShiftCode>;
  onRead: (image: string) => Promise<PhotoRead>;
  /** The second reading, started by itself as soon as her row is back. */
  onReadRoster: (image: string) => Promise<SecondRead>;
  onSave: (entries: readonly { date: IsoDate; code: ShiftCode }[]) => Promise<void>;
  onSaveRoster: (r: MonthRoster) => Promise<void>;
}

interface Reading {
  month: number;
  year: number;
  name: string;
  row: number | null;
  codes: (ShiftCode | null)[];
  unsure: Set<number>;
}

function fromReading(e: PhotoReading): Reading {
  const codes: (ShiftCode | null)[] = Array(daysInMonth(e.year, e.month)).fill(null);
  const unsure = new Set<number>();
  for (const g of e.days) {
    codes[g.day - 1] = g.code;
    if (!g.confident) unsure.add(g.day);
  }
  return { month: e.month, year: e.year, name: e.foundName, row: e.foundRow, codes, unsure };
}

/** Every way the second reading can fail ends here: a 504 at sixty seconds,
 *  an unusable answer, a failed checksum, the counter. None of them leads to
 *  a different gesture, so they all read the same. */
const ROSTER_FAILED = 'Le colleghe non si sono lette questa volta. I tuoi turni non cambiano.';

/** The other way round: the grid as it stands after the corrections. */
function toReading(l: Reading): PhotoReading {
  return {
    month: l.month,
    year: l.year,
    found: true,
    foundName: l.name,
    foundRow: l.row,
    days: l.codes.map((code, i) => ({ day: i + 1, code, confident: !l.unsure.has(i + 1) })),
  };
}

export function PhotoImport({
  year,
  existing,
  onRead,
  onReadRoster,
  onSave,
  onSaveRoster,
}: PhotoImportProps) {
  const [reading, setReading] = useState<Reading | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  // As in BulkEntry: the confirmation belongs to whoever knows when it goes
  // stale. Here it goes stale when she corrects a cell, which is the gesture
  // equivalent to typing in the textarea.
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [roster, setRoster] = useState<MonthRoster | null>(null);
  // Collapsed by default: fifteen rows times thirty-one days is five hundred
  // cells nobody would check unasked, and showing them would suggest the
  // data is as trustworthy as her own.
  const [openRoster, setOpenRoster] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterStatus, setRosterStatus] = useState<'idle' | 'reading' | 'failed'>('idle');
  // Which photo is current. A second reading that lands after she has put its
  // photo aside, or picked another, belongs to nothing on screen any more.
  const attempt = useRef(0);
  // The month she has selected, read when a late roster lands: it has to be
  // stored under the same month as her shifts, as `setMonth` ensures for a
  // roster already in hand.
  const selectedMonth = useRef<number | null>(null);
  // True once her shifts are saved and the grid has not changed since. A
  // roster landing then is saved by itself: she saved while it was reading
  // and has no reason to come back and press again.
  const shiftsSaved = useRef(false);
  const onSaveRosterRef = useRef(onSaveRoster);
  onSaveRosterRef.current = onSaveRoster;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    const id = ++attempt.current;
    try {
      const image = await resize(file);
      const { reading } = await onRead(image);
      if (id !== attempt.current) return;
      setReading(fromReading(reading));
      selectedMonth.current = reading.month;
      setRoster(null);
      setRosterStatus('reading');
      shiftsSaved.current = false;
      // Not awaited: her grid is on screen and editable now, and saving it
      // never waits for the colleagues. The checksum runs against call 1's
      // reading as it came back, not the grid she may be correcting: it
      // measures the second reading, not her edits.
      onReadRoster(image).then(
        (second) => {
          if (id !== attempt.current) return;
          const r = rosterFromSecondRead(reading, second);
          if (r === null) {
            setRosterStatus('failed');
            return;
          }
          const month = selectedMonth.current ?? r.month;
          const shaped = month === r.month ? r : reshapeRoster(r, r.year, month);
          setRoster(shaped);
          setRosterStatus('idle');
          if (shiftsSaved.current && shaped.people.length > 0) {
            onSaveRosterRef.current(shaped).catch((e: Error) => setRosterError(e.message));
          }
        },
        () => {
          if (id === attempt.current) setRosterStatus('failed');
        },
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  /** The edited grid, projected back into a reading so that which days get
   *  saved — blank means not scheduled, never a deletion — stays decided in
   *  one place, `core`, and not written a second time here. */
  const entries = useMemo(
    () => (reading === null ? [] : entriesFromReading(toReading(reading))),
    [reading],
  );

  const save = async (planned: readonly { date: IsoDate; code: ShiftCode }[]) => {
    // Her shifts first: they are the part that matters, and the part pay is
    // computed from.
    await onSave(planned);
    shiftsSaved.current = true;
    setRosterError(null);
    // An exception to "la foto nuova e' la verita' del mese", left unwritten
    // until now: PUT /roster replaces the whole month, so sending an empty
    // `people` array would be read as "the ward is now empty" and erase
    // whatever was already stored — this line is the only thing standing
    // between a bad or missing roster reading and that erasure. Do not
    // "fix" it in either direction without keeping both halves true.
    if (!roster || roster.people.length === 0) return;
    try {
      await onSaveRoster(roster);
    } catch (e) {
      // Her import succeeded. Failing the whole save here would send her back
      // to redo work that is already stored.
      setRosterError((e as Error).message);
    }
  };

  /** The month read from the title can be wrong, and taking the photo again
   *  wouldn't help: the model would read the same title again. Changing it,
   *  the grid shrinks or grows — a shorter month loses the days that no
   *  longer exist, a longer one adds them empty. */
  const setMonth = (month: number) => {
    selectedMonth.current = month;
    shiftsSaved.current = false;
    setReading((l) => {
      if (!l) return l;
      const howMany = daysInMonth(l.year, month);
      const codes = Array.from({ length: howMany }, (_, i) => l.codes[i] ?? null);
      const unsure = new Set([...l.unsure].filter((g) => g <= howMany));
      return { ...l, month, codes, unsure };
    });
    // The corrected month is the key the roster is stored under. If her grid
    // reshapes and the roster does not, her shifts land in one month and the
    // roster in another, and the calendar shows the wrong people with nothing
    // to signal it.
    setRoster((r) => (r === null ? r : reshapeRoster(r, r.year, month)));
    setRosterError(null);
    setSavedCount(null);
    setOpen(null);
  };

  const setDay = (day: number, code: ShiftCode | null) => {
    setReading((l) => {
      if (!l) return l;
      const codes = [...l.codes];
      codes[day - 1] = code;
      // Corrected by hand: it's no longer unsure, regardless.
      const unsure = new Set(l.unsure);
      unsure.delete(day);
      return { ...l, codes, unsure };
    });
    shiftsSaved.current = false;
    setSavedCount(null);
    setOpen(null);
  };

  // The app covers a single year: dates of a different year would find
  // nothing to compare against, and would be saved outside the visible calendar.
  const wrongYear = reading !== null && reading.year !== year;

  return (
    <div className="photo">
      {!reading && (
        <>
          {/* No `capture` on the input: the sheet arrives by WhatsApp, so the
              photo is already in her gallery. `capture` opens the camera and
              hides everything else — the one thing she never needs, because
              she is not standing in front of the sheet. */}
          <label className="photo-pick">
            <span aria-hidden="true">📷</span> Leggi da una foto
            <input
              type="file"
              accept="image/*"
              disabled={loading}
              onChange={(e) => void pick(e.target.files?.[0])}
            />
          </label>
          {loading && (
            <div className="waiting">
              <p>Leggo la foto… di solito ~30 secondi.</p>
              {/* No real progress exists inside one model call: the bar is
                  paced on the usual time (styles.css, .progresso) so she sees
                  the wait moving. Decoration only; the line above is the news. */}
              <div className="progresso" aria-hidden="true">
                <div />
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {reading && (
        <>
          <div className="photo-head">
            <label>
              <span>Mese</span>
              <select value={reading.month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name} {reading.year}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              riga trovata: {reading.name}
              {reading.row !== null && ` (${reading.row})`}
            </p>
            <button
              type="button"
              className="toggle"
              onClick={() => {
                setReading(null);
                setError(null);
                // `roster`, `rosterError` and `openRoster` are set together
                // with `reading` in `pick`; clear them together here too, so
                // this reset is not relying on the roster block's own
                // `reading`-gated render to hide a stale roster.
                setRoster(null);
                setRosterError(null);
                setOpenRoster(false);
                setRosterStatus('idle');
                attempt.current += 1;
              }}
            >
              ripeti con un altra foto
            </button>
          </div>

          {wrongYear ? (
            <p className="error" role="alert">
              Questa foto è del {reading.year}, ma l&apos;app tiene i turni del {year}. Non la
              posso caricare qui.
            </p>
          ) : (
            <>
              {/* The grid is weekday-aligned, like the calendar's. Without the
                  column labels the offset on day 1 reads as an unexplained
                  gap. Hidden from assistive technology: every cell already
                  names its own day, and these are not real column headers —
                  the grid is a group of buttons, not a table. */}
              <div className="photo-days" aria-hidden="true">
                {SHORT_DAY_NAMES.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>

              <div className="photo-grid" role="group" aria-label="Giorni letti dalla foto">
                {reading.codes.map((code, i) => {
                  const day = i + 1;
                  const wd = weekday(toIso(reading.year, reading.month, day));
                  return (
                    <button
                      key={day}
                      type="button"
                      style={day === 1 ? { gridColumnStart: wd + 1 } : undefined}
                      className={[
                        'photo-cell',
                        code ? `t-${code}` : 'empty',
                        reading.unsure.has(day) ? 'unsure' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-label={`${day} ${code ?? 'nessun turno'}`}
                      onClick={() => setOpen(day)}
                    >
                      <span className="day-number">{day}</span>
                      <span className="code">{code ?? '–'}</span>
                    </button>
                  );
                })}
              </div>

              {/* Read-only and collapsed by default: nobody edits five hundred
                  cells of somebody else's shifts, and showing them open would
                  imply that data is as trustworthy as her own row. */}
              {roster && roster.people.length > 0 && (
                <div className="roster-read">
                  <button
                    type="button"
                    className="toggle"
                    aria-expanded={openRoster}
                    onClick={() => setOpenRoster((o) => !o)}
                  >
                    lette {roster.people.length} persone
                  </button>
                  {openRoster && (
                    <div className="scroll-wrap">
                      <div className="roster-grid" role="group" aria-label="Turni letti degli altri">
                        {roster.people.map((p, i) => (
                          // Two rows can share a name — two people, not one — so
                          // the key also carries the row, never the name alone.
                          <div className="roster-row" key={`${p.name}-${p.row ?? i}`}>
                            <span className="roster-name">{p.name}</span>
                            {p.codes.map((c, d) => (
                              <span
                                key={d}
                                className={['roster-cell', c ? `t-${c}` : 'empty'].join(' ')}
                              >
                                {c || '–'}
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {rosterStatus === 'reading' && (
                <p className="waiting">
                  <span className="spinner" aria-hidden="true" />
                  Leggo anche le colleghe…
                </p>
              )}
              {rosterStatus === 'failed' && <p className="hint">{ROSTER_FAILED}</p>}

              {rosterError && (
                <p className="error" role="alert">
                  I tuoi turni sono salvati. I turni degli altri no: {rosterError}
                </p>
              )}

              <SavePlan
                entries={entries}
                existing={existing}
                month={reading.month}
                withoutShift={reading.codes.filter((c) => c === null).length}
                savedCount={savedCount}
                onSave={save}
                onSaved={setSavedCount}
              />
            </>
          )}
        </>
      )}

      {open !== null && reading && (
        <div className="sheet" role="dialog" aria-label={`Giorno ${open}`}>
          <div className="sheet-head">
            <strong>
              {open} {MONTH_NAMES[reading.month - 1]}
            </strong>
            <button type="button" onClick={() => setOpen(null)}>
              Chiudi
            </button>
          </div>
          <div className="sheet-body">
            <div className="codes">
              {SHIFTS.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  className={[
                    'code-btn',
                    `t-${s.code}`,
                    reading.codes[open - 1] === s.code ? 'on' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setDay(open, s.code)}
                >
                  {s.code}
                  <span>{s.description}</span>
                </button>
              ))}
            </div>
            <button type="button" className="toggle" onClick={() => setDay(open, null)}>
              Nessun turno
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
