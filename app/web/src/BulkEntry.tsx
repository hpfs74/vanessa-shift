/** Bulk entry: pick a month, paste a sequence of codes, review, save.
 *
 * The review step is not decoration. Pasting a sequence overwrites a whole
 * month in one action, and there is no undo.
 */

import { useMemo, useState } from 'react';

import type { IsoDate, ShiftCode } from '@vanessa/core';
import { MONTH_NAMES, parseSequence, planChanges } from '@vanessa/core';

export interface BulkEntryProps {
  year: number;
  month: number;
  onMonthChange: (m: number) => void;
  existing: ReadonlyMap<IsoDate, ShiftCode>;
  onSave: (entries: readonly { date: IsoDate; code: ShiftCode }[]) => Promise<void>;
}

export function BulkEntry({
  year,
  month,
  onMonthChange,
  existing,
  onSave,
}: BulkEntryProps) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  const parsed = useMemo(() => parseSequence(year, month, text), [year, month, text]);
  const plan = useMemo(() => planChanges(parsed.entries, existing), [parsed, existing]);

  const changed = plan.filter((c) => c.kind === 'changed');
  const created = plan.filter((c) => c.kind === 'new');
  const blocked = parsed.unknown.length > 0 || parsed.tooMany;

  const save = async () => {
    setSaving(true);
    setDone(null);
    try {
      await onSave(parsed.entries.map(({ date, code }) => ({ date, code })));
      setDone(parsed.entries.length);
      setText('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bulk">
      <h2>Caricamento rapido</h2>
      <p className="note">
        Scegli il mese e scrivi i codici in fila, uno per giorno a partire dal primo.
        Vanno bene virgole, spazi o a capo. Maiuscole e minuscole sono uguali.
      </p>

      <label>
        <span>Mese</span>
        <select value={month} onChange={(e) => onMonthChange(Number(e.target.value))}>
          {MONTH_NAMES.map((name, i) => (
            <option key={name} value={i + 1}>
              {name} {year}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Sequenza ({parsed.daysInMonth} giorni nel mese)</span>
        <textarea
          value={text}
          rows={5}
          placeholder="M M P1 L L M M1 P ..."
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setDone(null);
          }}
        />
      </label>

      {parsed.unknown.length > 0 && (
        <p className="error" role="alert">
          Non riconosco {parsed.unknown.map((u) => `"${u.token}" (posizione ${u.position})`).join(', ')}.
          I codici validi sono L, M, M1, P, P1. Correggi prima di salvare: saltarli
          sposterebbe di un giorno tutti quelli che seguono.
        </p>
      )}

      {parsed.tooMany && (
        <p className="error" role="alert">
          Hai scritto più codici dei {parsed.daysInMonth} giorni di{' '}
          {MONTH_NAMES[month - 1]}. Togline qualcuno.
        </p>
      )}

      {done !== null && (
        <p className="ok" role="status">
          Salvati {done} giorni di {MONTH_NAMES[month - 1]}.
        </p>
      )}

      {plan.length > 0 && !blocked && (
        <>
          <p className="summary-line">
            <strong>{created.length}</strong> giorni nuovi ·{' '}
            <strong>{changed.length}</strong> da sovrascrivere ·{' '}
            {plan.length - created.length - changed.length} già così
          </p>

          {changed.length > 0 && (
            <div className="scroll-wrap">
              <table>
                <caption>Giorni che verrebbero sovrascritti</caption>
                <thead>
                  <tr>
                    <th scope="col">Giorno</th>
                    <th scope="col">Ora</th>
                    <th scope="col">Diventa</th>
                  </tr>
                </thead>
                <tbody>
                  {changed.map((c) => (
                    <tr key={c.date}>
                      <th scope="row">{c.day}</th>
                      <td>{c.previous}</td>
                      <td>{c.code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button type="button" className="primary wide" disabled={saving} onClick={() => void save()}>
            {saving ? 'Salvo…' : `Salva ${plan.length} giorni`}
          </button>
        </>
      )}
    </section>
  );
}
