/** Date come stringhe ISO `YYYY-MM-DD`, sempre in ora locale civile.
 *
 * Il fuso non entra mai in gioco: un turno del 15 marzo e' il 15 marzo
 * ovunque lo si guardi. Usare `Date` con gli orari qui sarebbe un modo
 * elaborato per farsi spostare un giorno da un cambio d'ora.
 */

export type IsoDate = string;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function giorniNelMese(anno: number, mese: number): number {
  return new Date(Date.UTC(anno, mese, 0)).getUTCDate();
}

export function isIsoDate(v: unknown): v is IsoDate {
  if (typeof v !== 'string') return false;
  const m = ISO.exec(v);
  if (!m) return false;
  const [, a, ms, g] = m;
  const anno = Number(a);
  const mese = Number(ms);
  const giorno = Number(g);
  if (mese < 1 || mese > 12) return false;
  // Scarta il 31 novembre e il 29 febbraio degli anni non bisestili.
  return giorno >= 1 && giorno <= giorniNelMese(anno, mese);
}

export function parseIso(d: IsoDate): { anno: number; mese: number; giorno: number } {
  const m = ISO.exec(d);
  if (!m) throw new Error(`data non valida: ${d}`);
  return { anno: Number(m[1]), mese: Number(m[2]), giorno: Number(m[3]) };
}

export function toIso(anno: number, mese: number, giorno: number): IsoDate {
  const mm = String(mese).padStart(2, '0');
  const gg = String(giorno).padStart(2, '0');
  return `${anno}-${mm}-${gg}`;
}

/** 0 = lunedi ... 6 = domenica. La settimana lavorativa comincia di lunedi. */
export function giornoSettimana(d: IsoDate): number {
  const { anno, mese, giorno } = parseIso(d);
  const dow = new Date(Date.UTC(anno, mese - 1, giorno)).getUTCDay();
  return (dow + 6) % 7;
}

export function isSabato(d: IsoDate): boolean {
  return giornoSettimana(d) === 5;
}

export function isDomenica(d: IsoDate): boolean {
  return giornoSettimana(d) === 6;
}

export function giorniDelMese(anno: number, mese: number): IsoDate[] {
  const n = giorniNelMese(anno, mese);
  return Array.from({ length: n }, (_, i) => toIso(anno, mese, i + 1));
}

export function giorniDellAnno(anno: number): IsoDate[] {
  const out: IsoDate[] = [];
  for (let m = 1; m <= 12; m++) out.push(...giorniDelMese(anno, m));
  return out;
}

export function addGiorni(d: IsoDate, n: number): IsoDate {
  const { anno, mese, giorno } = parseIso(d);
  const t = new Date(Date.UTC(anno, mese - 1, giorno + n));
  return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function differenzaGiorni(a: IsoDate, b: IsoDate): number {
  const pa = parseIso(a);
  const pb = parseIso(b);
  const ta = Date.UTC(pa.anno, pa.mese - 1, pa.giorno);
  const tb = Date.UTC(pb.anno, pb.mese - 1, pb.giorno);
  return Math.round((tb - ta) / 86_400_000);
}

export const MESI = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
] as const;

export const GIORNI_BREVI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'] as const;
