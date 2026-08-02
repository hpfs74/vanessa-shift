/** Codici turno: unica fonte di verita' per ore e orari. */

export type Codice = 'L' | 'M' | 'M1' | 'P' | 'P1';

export interface Turno {
  readonly cod: Codice;
  readonly descrizione: string;
  readonly inizio: string;
  readonly fine: string;
  readonly ore: number;
}

export const CODICI: readonly Turno[] = [
  { cod: 'L', descrizione: 'Libero', inizio: '', fine: '', ore: 0 },
  { cod: 'M', descrizione: 'Mattina', inizio: '07:00', fine: '13:00', ore: 6 },
  { cod: 'M1', descrizione: 'Mattina lunga', inizio: '07:00', fine: '14:00', ore: 7 },
  { cod: 'P', descrizione: 'Pomeriggio', inizio: '13:00', fine: '20:00', ore: 7 },
  { cod: 'P1', descrizione: 'Pomeriggio lungo', inizio: '13:00', fine: '21:00', ore: 8 },
];

const PER_CODICE = new Map(CODICI.map((t) => [t.cod, t]));

export function isCodice(v: unknown): v is Codice {
  return typeof v === 'string' && PER_CODICE.has(v as Codice);
}

export function turno(cod: Codice): Turno {
  const t = PER_CODICE.get(cod);
  if (!t) throw new Error(`codice turno sconosciuto: ${cod}`);
  return t;
}

/** Ore del codice. Un giorno senza codice non vale zero ore: non esiste. */
export function ore(cod: Codice | undefined | null): number {
  return cod ? turno(cod).ore : 0;
}

/** Orario leggibile, con la lineetta per i giorni liberi. */
export function orario(cod: Codice): string {
  const t = turno(cod);
  return t.inizio ? `${t.inizio}-${t.fine}` : '–';
}
