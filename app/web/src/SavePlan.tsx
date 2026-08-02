/** What saving would do, and the button to do it.
 *
 * It lives in its own component because two paths lead here — the hand-typed
 * sequence and the photo — and the review before overwriting is exactly the
 * part that must not depend on how you got there.
 */

import { useMemo, useState } from 'react';

import type { IsoDate, ParsedEntry, ShiftCode } from '@vanessa/core';
import { MONTH_NAMES, planChanges } from '@vanessa/core';

export interface SavePlanProps {
  entries: readonly ParsedEntry[];
  existing: ReadonlyMap<IsoDate, ShiftCode>;
  month: number;
  /** Giorni del mese senza turno: mostrati nel riepilogo, non salvati. */
  withoutShift?: number;
  /** Blocca il salvataggio quando l'input a monte non e' valido. */
  blocked?: boolean;
  /** Numero di giorni salvati da mostrare in conferma, o null per non mostrarla.
   *  Il chiamante decide quando invalidarla: solo lui sa quando la sorgente e' cambiata. */
  savedCount: number | null;
  onSave: (entries: readonly { date: IsoDate; code: ShiftCode }[]) => Promise<void>;
  /** Chiamato dopo un salvataggio riuscito, con il numero di giorni salvati. */
  onSaved: (count: number) => void;
}

export function SavePlan({
  entries,
  existing,
  month,
  withoutShift = 0,
  blocked = false,
  savedCount,
  onSave,
  onSaved,
}: SavePlanProps) {
  const [saving, setSaving] = useState(false);

  const plan = useMemo(() => planChanges(entries, existing), [entries, existing]);
  const changed = plan.filter((c) => c.kind === 'changed');
  const created = plan.filter((c) => c.kind === 'new');

  const save = async () => {
    setSaving(true);
    try {
      await onSave(entries.map(({ date, code }) => ({ date, code })));
      onSaved(entries.length);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {savedCount !== null && (
        <p className="ok" role="status">
          Salvati {savedCount} giorni di {MONTH_NAMES[month - 1]}.
        </p>
      )}

      {plan.length > 0 && !blocked && (
        <>
          <p className="summary-line">
            <strong>{created.length}</strong> giorni nuovi ·{' '}
            <strong>{changed.length}</strong> da sovrascrivere ·{' '}
            {plan.length - created.length - changed.length} già così
            {withoutShift > 0 && <> · {withoutShift} senza turno</>}
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

          <button
            type="button"
            className="primary wide"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Salvo…' : `Salva ${plan.length} giorni`}
          </button>
        </>
      )}
    </>
  );
}
