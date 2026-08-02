/** Ripartizione delle ore e simulazione dello stipendio.
 *
 * Ogni ora lavorata cade in esattamente una categoria, con precedenza
 * festivo > domenica > sabato. Le ore ordinarie NON sono un resto: si
 * calcolano per appartenenza come le altre, cosi' una doppia
 * contabilizzazione non puo' nascondersi erodendole in silenzio.
 */

import { type Codice, ore as oreDelCodice } from './codici.js';
import { type IsoDate, giorniDelMese } from './date.js';
import { festiviItaliani, tipoGiorno } from './festivi.js';

export interface Giorno {
  readonly data: IsoDate;
  readonly cod?: Codice | null;
}

export interface OreMese {
  readonly ordinarie: number;
  readonly sabato: number;
  readonly domenica: number;
  readonly festivo: number;
  readonly totale: number;
}

export interface Paga {
  readonly tariffaOraria: number | null;
  readonly maggSabato: number | null;
  readonly maggDomenica: number | null;
  readonly maggFestivo: number | null;
  readonly rateo13a: number | null;
  readonly coeffNetto: number | null;
}

export const PAGA_VUOTA: Paga = {
  tariffaOraria: null,
  maggSabato: null,
  maggDomenica: null,
  maggFestivo: null,
  rateo13a: 1 / 12,
  coeffNetto: null,
};

/** Ripartisce le ore di un mese. `turni` mappa data ISO -> codice. */
export function oreDelMese(
  anno: number,
  mese: number,
  turni: ReadonlyMap<IsoDate, Codice | null | undefined>,
): OreMese {
  const festivi = festiviItaliani(anno);
  let ordinarie = 0;
  let sabato = 0;
  let domenica = 0;
  let festivo = 0;

  for (const d of giorniDelMese(anno, mese)) {
    const h = oreDelCodice(turni.get(d));
    if (h === 0) continue;
    switch (tipoGiorno(d, festivi)) {
      case 'festivo':
        festivo += h;
        break;
      case 'domenica':
        domenica += h;
        break;
      case 'sabato':
        sabato += h;
        break;
      default:
        ordinarie += h;
    }
  }

  return {
    ordinarie,
    sabato,
    domenica,
    festivo,
    totale: ordinarie + sabato + domenica + festivo,
  };
}

export interface ImportiMese {
  readonly lordoBase: number | null;
  readonly maggSabato: number | null;
  readonly maggDomenica: number | null;
  readonly maggFestivo: number | null;
  readonly rateo13a: number | null;
  readonly lordoTotale: number | null;
  readonly nettoStimato: number | null;
}

const VUOTI: ImportiMese = {
  lordoBase: null,
  maggSabato: null,
  maggDomenica: null,
  maggFestivo: null,
  rateo13a: null,
  lordoTotale: null,
  nettoStimato: null,
};

/** Nessuna cifra compare finche' il parametro da cui dipende non e' compilato. */
export function importiDelMese(o: OreMese, p: Paga): ImportiMese {
  if (p.tariffaOraria == null) return VUOTI;

  const lordoBase = o.totale * p.tariffaOraria;
  const mSab = p.maggSabato == null ? null : o.sabato * p.tariffaOraria * p.maggSabato;
  const mDom = p.maggDomenica == null ? null : o.domenica * p.tariffaOraria * p.maggDomenica;
  const mFest = p.maggFestivo == null ? null : o.festivo * p.tariffaOraria * p.maggFestivo;

  // Il rateo si calcola su cio' che e' noto: una maggiorazione non impostata
  // vale zero nella somma, non rende indefinito tutto il resto.
  const imponibile = lordoBase + (mSab ?? 0) + (mDom ?? 0) + (mFest ?? 0);
  const rateo = p.rateo13a == null ? null : imponibile * p.rateo13a;
  const lordoTotale = imponibile + (rateo ?? 0);
  const netto = p.coeffNetto == null ? null : lordoTotale * p.coeffNetto;

  return {
    lordoBase,
    maggSabato: mSab,
    maggDomenica: mDom,
    maggFestivo: mFest,
    rateo13a: rateo,
    lordoTotale,
    nettoStimato: netto,
  };
}

/** Somma su piu' mesi. Resta `null` se ogni addendo e' `null`. */
export function sommaImporti(importi: readonly ImportiMese[]): ImportiMese {
  const chiavi = Object.keys(VUOTI) as (keyof ImportiMese)[];
  const out = {} as Record<keyof ImportiMese, number | null>;
  for (const k of chiavi) {
    const valori = importi.map((i) => i[k]).filter((v): v is number => v != null);
    out[k] = valori.length === 0 ? null : valori.reduce((a, b) => a + b, 0);
  }
  return out as ImportiMese;
}
