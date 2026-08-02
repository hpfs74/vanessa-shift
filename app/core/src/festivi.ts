/** Festivi nazionali italiani. Il patrono locale non c'e'. */

import { type IsoDate, addGiorni, toIso } from './date.js';

/** Domenica di Pasqua, algoritmo gregoriano anonimo. */
export function pasqua(anno: number): IsoDate {
  const a = anno % 19;
  const b = Math.floor(anno / 100);
  const c = anno % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31);
  const giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return toIso(anno, mese, giorno);
}

export function festiviItaliani(anno: number): Map<IsoDate, string> {
  const festivi = new Map<IsoDate, string>([
    [toIso(anno, 1, 1), 'Capodanno'],
    [toIso(anno, 1, 6), 'Epifania'],
    [toIso(anno, 4, 25), 'Liberazione'],
    [toIso(anno, 5, 1), 'Festa del Lavoro'],
    [toIso(anno, 6, 2), 'Festa della Repubblica'],
    [toIso(anno, 8, 15), 'Ferragosto'],
    [toIso(anno, 11, 1), 'Ognissanti'],
    [toIso(anno, 12, 8), 'Immacolata'],
    [toIso(anno, 12, 25), 'Natale'],
    [toIso(anno, 12, 26), 'Santo Stefano'],
  ]);
  // Se la Pasquetta cade il 25 aprile e' un giorno solo, non due: vince il nome fisso.
  const pasquetta = addGiorni(pasqua(anno), 1);
  if (!festivi.has(pasquetta)) festivi.set(pasquetta, "Lunedi dell'Angelo");
  return festivi;
}

export type TipoGiorno = 'feriale' | 'sabato' | 'domenica' | 'festivo';

/** Precedenza: festivo batte domenica, domenica batte sabato. */
export function tipoGiorno(d: IsoDate, festivi: Map<IsoDate, string>): TipoGiorno {
  if (festivi.has(d)) return 'festivo';
  const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  if (dow === 6) return 'domenica';
  if (dow === 5) return 'sabato';
  return 'feriale';
}
