/** The month as an iCalendar file, for Calendar on the iPhone.
 *
 *  Everything that can go wrong lives here — which days become events, what
 *  identifies them, who gets an alarm, how text is escaped — and none of it
 *  touches the browser, so all of it is provable with `expect` on a string.
 */

import { type DayEntry, type Shift, shift } from './shifts.js';
import { type IsoDate, monthDays } from './dates.js';

/** Half of every UID, so changing it makes every event she already imported
 *  look like a different event. It is not the login domain and does not need
 *  to be: a UID is an identifier, not an address. */
const DOMINIO = 'vanessa.matteo.cool';

/** Not exported: nothing outside this file needs it, and an export nobody
 *  imports is a promise nobody asked for. */
const NOME_CALENDARIO = 'Turni di Vanessa';

/** RFC 5545 escaping for a TEXT value. The backslash goes first, or it would
 *  escape the escapes added after it.
 *
 *  Exported so its escaping rules can be tested: no current real data
 *  (shift descriptions, codes, calendar name) contains `\`, `;`, `,`, or
 *  newlines, so the escape logic is otherwise unreachable and unverifiable. */
export function escapeIcsText(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Alias for backwards compatibility within this module. */
const testo = escapeIcsText;

/** `2026-08-13` + `07:00` -> `20260813T070000`, with no zone: see the spec. */
function dataOra(d: IsoDate, hhmm: string): string {
  return `${d.replace(/-/g, '')}T${hhmm.replace(':', '')}00`;
}

/** `DTSTAMP` is the one field that is a real instant, so it is the one field
 *  in UTC. */
function istante(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
}

/** The alarm goes on the shifts that start in the morning, and only those.
 *  Twelve hours before a 07:00 start is 19:00 the evening before, which is
 *  when knowing about it still helps. Twelve hours before a 13:00 start is
 *  01:00, which is a roster waking up the person who works it. */
function iniziaLaMattina(s: Shift): boolean {
  // Zero-padded HH:MM compares correctly as a string.
  // The `s.start !== ''` check is defensive: turniDelMese already filters out
  // shifts with no start time, so this condition is unreachable, but it
  // documents the invariant that we only compare times that exist.
  return s.start !== '' && s.start < '12:00';
}

/** The days of that month that become events, in order. Libero is not one of
 *  them: with no start and no end it could only be an all-day banner over a
 *  day on which nothing happens. */
function turniDelMese(
  year: number,
  month: number,
  days: ReadonlyMap<IsoDate, DayEntry>,
): { date: IsoDate; s: Shift }[] {
  const out: { date: IsoDate; s: Shift }[] = [];
  for (const date of monthDays(year, month)) {
    const e = days.get(date);
    if (!e) continue;
    const s = shift(e.code);
    if (!s.start || !s.end) continue;
    out.push({ date, s });
  }
  return out;
}

export function contaTurniEsportabili(
  year: number,
  month: number,
  days: ReadonlyMap<IsoDate, DayEntry>,
): number {
  return turniDelMese(year, month, days).length;
}

/** `sequence` and `now` come from outside because `core` reads neither the
 *  clock nor `localStorage`: the counter lives in the browser, and a test
 *  that depends on the time it runs at is not a test. */
export function icsDelMese(
  year: number,
  month: number,
  days: ReadonlyMap<IsoDate, DayEntry>,
  sequence: number,
  now: Date,
): string {
  const stamp = istante(now);
  const righe: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${DOMINIO}//turni//IT`,
    `X-WR-CALNAME:${testo(NOME_CALENDARIO)}`,
  ];

  for (const { date, s } of turniDelMese(year, month, days)) {
    const titolo = `${s.description} (${s.code})`;
    righe.push(
      'BEGIN:VEVENT',
      // Built from the date alone, so the same day exported twice keeps the
      // same identity and Calendar can update it instead of adding a second.
      `UID:turno-${date}@${DOMINIO}`,
      `DTSTAMP:${stamp}`,
      `SEQUENCE:${sequence}`,
      `DTSTART:${dataOra(date, s.start)}`,
      `DTEND:${dataOra(date, s.end)}`,
      `SUMMARY:${testo(titolo)}`,
    );
    if (iniziaLaMattina(s)) {
      righe.push(
        'BEGIN:VALARM',
        'TRIGGER:-PT12H',
        'ACTION:DISPLAY',
        // Required by ACTION:DISPLAY, and it is the text of the notification.
        // This is the alarm's DESCRIPTION, not the event's, which stays absent.
        `DESCRIPTION:${testo(titolo)}`,
        'END:VALARM',
      );
    }
    righe.push('END:VEVENT');
  }

  righe.push('END:VCALENDAR');
  // CRLF, and a trailing one: the standard asks for it and strict parsers
  // enforce it. No 75-octet folding — the longest lines we emit are
  // `UID:turno-2026-08-13@vanessa.matteo.cool` and
  // `PRODID:-//vanessa.matteo.cool//turni//IT`, both 40 characters, well
  // under the limit. Putting free text in a DESCRIPTION on the event would
  // need folding immediately.
  return righe.join('\r\n') + '\r\n';
}
