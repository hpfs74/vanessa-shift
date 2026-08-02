/** Full edit of one day: shift, swap, colleague, notes.
 *
 * A bottom sheet, because on a phone the bottom of the screen is where the
 * thumb already is. Visible text stays in Italian.
 */

import { useEffect, useState } from 'react';

import type { IsoDate, ShiftCode } from '@vanessa/core';
import { SHIFTS, SWAP_KINDS, hours, timeRange } from '@vanessa/core';

import type { RemoteShift } from './api.js';

export interface DayEditorProps {
  date: IsoDate;
  shift: RemoteShift | null;
  colleagues: readonly string[];
  onSave: (shift: RemoteShift) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function DayEditor({
  date,
  shift,
  colleagues,
  onSave,
  onDelete,
  onClose,
}: DayEditorProps) {
  const [code, setCode] = useState<ShiftCode | null>(shift?.code ?? null);
  const [originalCode, setOriginalCode] = useState<ShiftCode | ''>(shift?.originalCode ?? '');
  const [colleague, setColleague] = useState(shift?.colleague ?? '');
  const [swapKind, setSwapKind] = useState(shift?.swapKind ?? '');
  const [notes, setNotes] = useState(shift?.notes ?? '');
  const [showSwap, setShowSwap] = useState(Boolean(shift?.originalCode || shift?.swapKind));

  useEffect(() => {
    setCode(shift?.code ?? null);
    setOriginalCode(shift?.originalCode ?? '');
    setColleague(shift?.colleague ?? '');
    setSwapKind(shift?.swapKind ?? '');
    setNotes(shift?.notes ?? '');
    setShowSwap(Boolean(shift?.originalCode || shift?.swapKind));
  }, [shift, date]);

  const delta = code && originalCode ? hours(code) - hours(originalCode) : null;

  return (
    <div className="sheet" role="dialog" aria-label={`Turno del ${date}`}>
      <div className="sheet-head">
        <strong>{date.split('-').reverse().join('/')}</strong>
        <button type="button" className="link" onClick={onClose}>
          Chiudi
        </button>
      </div>

      <div className="sheet-body">
        <fieldset>
          <legend>Turno</legend>
          <div className="codes">
            {SHIFTS.map((s) => (
              <button
                key={s.code}
                type="button"
                className={`code-btn t-${s.code} ${code === s.code ? 'on' : ''}`}
                aria-pressed={code === s.code}
                onClick={() => setCode(s.code)}
              >
                <strong>{s.code}</strong>
                <span>{s.description}</span>
                <small>{timeRange(s.code)}</small>
              </button>
            ))}
          </div>
          {code && (
            <p className="hint">
              {hours(code)} ore · {timeRange(code)}
            </p>
          )}
        </fieldset>

        <button
          type="button"
          className="toggle"
          aria-expanded={showSwap}
          onClick={() => setShowSwap((v) => !v)}
        >
          {showSwap ? '−' : '+'} Scambio con una collega
        </button>

        {showSwap && (
          <fieldset>
            <legend>Scambio</legend>

            <label>
              <span>Turno che avevo in origine</span>
              <select
                value={originalCode}
                onChange={(e) => setOriginalCode(e.target.value as ShiftCode | '')}
              >
                <option value="">— nessuno —</option>
                {SHIFTS.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} · {s.description}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Collega</span>
              <input
                type="text"
                list="colleghe"
                value={colleague}
                placeholder="nome"
                autoComplete="off"
                onChange={(e) => setColleague(e.target.value)}
              />
              <datalist id="colleghe">
                {colleagues.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>

            <label>
              <span>Tipo di scambio</span>
              <select value={swapKind} onChange={(e) => setSwapKind(e.target.value)}>
                <option value="">— nessuno —</option>
                {SWAP_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>

            {delta !== null && (
              <p className="hint">
                Differenza ore: <strong>{delta > 0 ? `+${delta}` : delta}</strong>
                {delta > 0 && ' — hai lavorato più del previsto'}
                {delta < 0 && ' — hai lavorato meno del previsto'}
              </p>
            )}
          </fieldset>
        )}

        <label>
          <span>Note</span>
          <textarea
            value={notes}
            rows={2}
            maxLength={500}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>

      <div className="sheet-actions">
        <button type="button" className="danger" disabled={!shift} onClick={onDelete}>
          Cancella giorno
        </button>
        <button
          type="button"
          className="primary"
          disabled={!code}
          onClick={() =>
            code &&
            onSave({
              date,
              code,
              originalCode: originalCode || null,
              colleague: colleague.trim() || null,
              swapKind: swapKind || null,
              notes: notes.trim() || null,
            })
          }
        >
          Salva
        </button>
      </div>
    </div>
  );
}
