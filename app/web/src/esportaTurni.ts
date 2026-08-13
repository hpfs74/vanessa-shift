/** Getting the month onto the phone.
 *
 *  The two things `core` cannot do: the counter, which lives in this browser,
 *  and the download itself. Kept apart from `ics.ts` on purpose — this is the
 *  half that only a real iPhone can confirm, and if it turns out to need a
 *  different route to Calendar, nothing about the file has to change.
 */

import type { DayEntry, IsoDate } from '@vanessa/core';
import { icsDelMese } from '@vanessa/core';

const PREFISSO = 'ics:';

/** `SEQUENCE` has to grow for a client to read an event as a newer version of
 *  one it already has, rather than as a new one. There is no server state
 *  here, so the count lives per month in this browser: from another phone it
 *  starts at zero again, which is fine because the re-import happens on the
 *  phone that exported. */
function prossimaSequenza(chiave: string): number {
  const grezzo = localStorage.getItem(chiave);
  const n = Number(grezzo);
  // Anything that is not a whole number — absent, junk, someone else's write —
  // starts over rather than failing the export.
  const corrente = Number.isInteger(n) && n >= 0 ? n : 0;
  localStorage.setItem(chiave, String(corrente + 1));
  return corrente;
}

export function esportaMese(
  year: number,
  month: number,
  days: ReadonlyMap<IsoDate, DayEntry>,
  now: Date = new Date(),
): void {
  const mese = String(month).padStart(2, '0');
  const sequenza = prossimaSequenza(`${PREFISSO}${year}-${mese}`);
  const testo = icsDelMese(year, month, days, sequenza, now);

  const blob = new Blob([testo], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `turni-${year}-${mese}.ics`;
  // Firefox has historically required the anchor to be in the document for
  // the download to start, and Safari's behaviour has moved between
  // versions — attached-clicked-removed is the version every browser agrees on.
  document.body.append(a);
  a.click();
  a.remove();
  // Revoked on the next tick, not now: revoking synchronously can pull the
  // blob out from under a download that has not started reading it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
