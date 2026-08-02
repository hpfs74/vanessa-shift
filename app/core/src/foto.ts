/** Import da una foto del foglio dei turni.
 *
 * Qui non si legge nessuna immagine: qui si decide se quello che il modello
 * ha detto di aver letto e utilizzabile. Mezza griglia plausibile e peggio di
 * un errore, perche si salva senza accorgersene: la validazione e quindi tutto
 * o niente.
 */

import { type IsoDate, daysInMonth, toIso } from './dates.js';
import type { ParsedEntry } from './bulk.js';
import { type ShiftCode, SHIFTS, isShiftCode } from './shifts.js';

/** La riga da cercare sul foglio. */
export const NOME_RIGA = 'Vanessa';

/** L'API e aperta e ogni lettura costa: il tetto e la difesa principale. */
export const MAX_LETTURE_AL_GIORNO = 10;

export interface GiornoLetto {
  readonly giorno: number;
  /** null vuol dire "sul foglio non c'e un turno": una x, una cella vuota,
   *  o una cella illeggibile. Ai fini del salvataggio sono la stessa cosa. */
  readonly codice: ShiftCode | null;
  /** Suggerimento del modello, non verdetto: serve a sottolineare la cella.
   *  Tutte le celle restano modificabili. */
  readonly sicuro: boolean;
}

export interface EstrazioneFoto {
  readonly mese: number;
  readonly anno: number;
  readonly trovata: boolean;
  readonly nomeTrovato: string | null;
  readonly rigaTrovata: number | null;
  readonly giorni: readonly GiornoLetto[];
}

/** La forma che il modello e obbligato a restituire.
 *
 * Niente minimi e massimi numerici: gli output strutturati non li applicano,
 * e comunque il giudice e validaEstrazione, non lo schema. */
export const SCHEMA_ESTRAZIONE: Record<string, unknown> = {
  type: 'object',
  properties: {
    mese: { type: 'integer' },
    anno: { type: 'integer' },
    trovata: { type: 'boolean' },
    nomeTrovato: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    rigaTrovata: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    giorni: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          giorno: { type: 'integer' },
          codice: {
            anyOf: [{ type: 'string', enum: SHIFTS.map((s) => s.code) }, { type: 'null' }],
          },
          sicuro: { type: 'boolean' },
        },
        required: ['giorno', 'codice', 'sicuro'],
        additionalProperties: false,
      },
    },
  },
  required: ['mese', 'anno', 'trovata', 'nomeTrovato', 'rigaTrovata', 'giorni'],
  additionalProperties: false,
};

/** L'estrazione non si puo usare. */
export class FotoNonValida extends Error {}

/** La riga cercata non c'e nella foto: e un caso a parte, perche il rimedio
 *  che si suggerisce e diverso (rifotografare, non riscrivere). */
export class RigaNonTrovata extends Error {}

function intero(v: unknown, campo: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new FotoNonValida(`${campo}: atteso un intero`);
  }
  return v;
}

export function validaEstrazione(v: unknown, annoAtteso: number): EstrazioneFoto {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new FotoNonValida('estrazione: atteso un oggetto');
  }
  const e = v as Record<string, unknown>;

  if (e.trovata !== true) throw new RigaNonTrovata(`riga di ${NOME_RIGA} non trovata`);

  const mese = intero(e.mese, 'mese');
  if (mese < 1 || mese > 12) throw new FotoNonValida('mese: fuori da 1-12');

  const anno = intero(e.anno, 'anno');
  if (Math.abs(anno - annoAtteso) > 1) throw new FotoNonValida('anno: troppo lontano');

  if (typeof e.nomeTrovato !== 'string' || e.nomeTrovato.length === 0) {
    throw new FotoNonValida('nomeTrovato: atteso un nome');
  }
  const rigaTrovata = intero(e.rigaTrovata, 'rigaTrovata');

  if (!Array.isArray(e.giorni)) throw new FotoNonValida('giorni: atteso un elenco');
  const attesi = daysInMonth(anno, mese);
  if (e.giorni.length !== attesi) {
    throw new FotoNonValida(`giorni: attesi ${attesi}, ricevuti ${e.giorni.length}`);
  }

  const visti = new Set<number>();
  const giorni: GiornoLetto[] = e.giorni.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new FotoNonValida(`giorni[${i}]: atteso un oggetto`);
    }
    const g = raw as Record<string, unknown>;
    const giorno = intero(g.giorno, `giorni[${i}].giorno`);
    if (giorno < 1 || giorno > attesi) {
      throw new FotoNonValida(`giorni[${i}].giorno: ${giorno} non e nel mese`);
    }
    // Lo stesso giorno due volte vorrebbe dire che una colonna e stata letta
    // due volte e un'altra mai: la griglia non e allineata.
    if (visti.has(giorno)) throw new FotoNonValida(`giorno ${giorno} compare due volte`);
    visti.add(giorno);

    const codice = g.codice;
    if (codice !== null && !isShiftCode(codice)) {
      throw new FotoNonValida(`giorni[${i}].codice: codice turno sconosciuto`);
    }
    if (typeof g.sicuro !== 'boolean') {
      throw new FotoNonValida(`giorni[${i}].sicuro: atteso un booleano`);
    }
    return { giorno, codice: codice as ShiftCode | null, sicuro: g.sicuro };
  });

  return { mese, anno, trovata: true, nomeTrovato: e.nomeTrovato, rigaTrovata, giorni };
}

/** Solo i giorni con un turno. Gli altri non si salvano e non cancellano
 *  nulla: una foto puo essere tagliata, e cancellare non ha ritorno. */
export function vociDaEstrazione(e: EstrazioneFoto): ParsedEntry[] {
  const out: ParsedEntry[] = [];
  for (const g of e.giorni) {
    if (g.codice === null) continue;
    out.push({ date: toIso(e.anno, e.mese, g.giorno), day: g.giorno, code: g.codice });
  }
  return out;
}

export type { IsoDate };
