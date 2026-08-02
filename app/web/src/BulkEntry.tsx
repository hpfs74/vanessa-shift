/** Bulk entry: pick a month, paste a sequence of codes, review, save.
 *
 * The review step is not decoration. Pasting a sequence overwrites a whole
 * month in one action, and there is no undo — so it lives in
 * SavePlan, shared with the photo import.
 */

import { useMemo, useState } from 'react';

import type { IsoDate, ShiftCode } from '@vanessa/core';
import { MONTH_NAMES, parseSequence } from '@vanessa/core';

import { PhotoImport } from './PhotoImport.js';
import { SavePlan } from './SavePlan.js';

export interface BulkEntryProps {
  year: number;
  month: number;
  onMonthChange: (m: number) => void;
  existing: ReadonlyMap<IsoDate, ShiftCode>;
  onSave: (entries: readonly { date: IsoDate; code: ShiftCode }[]) => Promise<void>;
  onReadPhoto: (image: string) => Promise<import('@vanessa/core').PhotoReading>;
}

export function BulkEntry({
  year,
  month,
  onMonthChange,
  existing,
  onSave,
  onReadPhoto,
}: BulkEntryProps) {
  const [text, setText] = useState('');
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const parsed = useMemo(() => parseSequence(year, month, text), [year, month, text]);
  const blocked = parsed.unknown.length > 0 || parsed.tooMany;

  return (
    <section className="bulk">
      <h2>Caricamento rapido</h2>

      <PhotoImport year={year} existing={existing} onRead={onReadPhoto} onSave={onSave} />

      <p className="note">oppure scrivi i codici a mano:</p>
      <p className="note">
        Scegli il mese e scrivi i codici in fila, uno per giorno a partire dal primo.
        Vanno bene virgole, spazi o a capo. Maiuscole e minuscole sono uguali.
      </p>

      <label>
        <span>Mese</span>
        <select
          value={month}
          onChange={(e) => {
            onMonthChange(Number(e.target.value));
            setSavedCount(null);
          }}
        >
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
            setSavedCount(null);
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

      <SavePlan
        entries={parsed.entries}
        existing={existing}
        month={month}
        blocked={blocked}
        savedCount={savedCount}
        onSave={onSave}
        onSaved={(count) => {
          setText('');
          setSavedCount(count);
        }}
      />
    </section>
  );
}
