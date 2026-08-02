import { describe, expect, it } from 'vitest';

import {
  FotoNonValida,
  RigaNonTrovata,
  giornoRoma,
  validaEstrazione,
  vociDaEstrazione,
} from '../src/index.js';

/** Un'estrazione ben formata di `giorni` giorni, tutti senza turno. */
function vuota(mese: number, anno: number, giorni: number) {
  return {
    mese,
    anno,
    trovata: true,
    nomeTrovato: 'Vanessa',
    rigaTrovata: 14,
    giorni: Array.from({ length: giorni }, (_, i) => ({
      giorno: i + 1,
      codice: null,
      sicuro: true,
    })),
  };
}

/** Luglio come sta sulla foto: x fino al 16, poi quindici turni. */
const LUGLIO_CODICI = ['M','M','P','L','P','M','M','M','L','P','M','M','M','L','P'] as const;

function luglio() {
  const e = vuota(7, 2026, 31);
  LUGLIO_CODICI.forEach((codice, i) => {
    e.giorni[16 + i] = { giorno: 17 + i, codice, sicuro: true } as never;
  });
  return e;
}

describe('validaEstrazione', () => {
  it('accetta un mese intero ben formato', () => {
    const e = validaEstrazione(vuota(8, 2026, 31), 2026);
    expect(e.mese).toBe(8);
    expect(e.giorni).toHaveLength(31);
  });

  it('accetta l anno prima e quello dopo, non uno lontano', () => {
    expect(() => validaEstrazione(vuota(8, 2025, 31), 2026)).not.toThrow();
    expect(() => validaEstrazione(vuota(8, 2027, 31), 2026)).not.toThrow();
    expect(() => validaEstrazione(vuota(8, 2019, 31), 2026)).toThrow(FotoNonValida);
  });

  it('rifiuta un mese fuori scala', () => {
    expect(() => validaEstrazione({ ...vuota(1, 2026, 31), mese: 13 }, 2026)).toThrow(
      FotoNonValida,
    );
  });

  it('vuole esattamente i giorni del mese: febbraio 2026 ne ha 28', () => {
    expect(() => validaEstrazione(vuota(2, 2026, 28), 2026)).not.toThrow();
    expect(() => validaEstrazione(vuota(2, 2026, 29), 2026)).toThrow(FotoNonValida);
  });

  it('rifiuta un giorno mancante', () => {
    const e = vuota(8, 2026, 31);
    e.giorni.splice(10, 1);
    expect(() => validaEstrazione(e, 2026)).toThrow(FotoNonValida);
  });

  it('rifiuta un giorno duplicato', () => {
    const e = vuota(8, 2026, 31);
    e.giorni[11] = { giorno: 11, codice: null, sicuro: true };
    expect(() => validaEstrazione(e, 2026)).toThrow(FotoNonValida);
  });

  it('rifiuta un giorno fuori dal mese', () => {
    const e = vuota(8, 2026, 31);
    e.giorni[30] = { giorno: 32, codice: null, sicuro: true };
    expect(() => validaEstrazione(e, 2026)).toThrow(FotoNonValida);
  });

  it('rifiuta un codice che non esiste', () => {
    const e = vuota(8, 2026, 31);
    e.giorni[0] = { giorno: 1, codice: 'P2' as never, sicuro: true };
    expect(() => validaEstrazione(e, 2026)).toThrow(FotoNonValida);
  });

  it('rifiuta qualcosa che non e nemmeno un oggetto', () => {
    expect(() => validaEstrazione('ciao', 2026)).toThrow(FotoNonValida);
    expect(() => validaEstrazione(null, 2026)).toThrow(FotoNonValida);
    expect(() => validaEstrazione([], 2026)).toThrow(FotoNonValida);
  });

  it('quando la riga non c e lo dice con un errore suo', () => {
    const e = { ...vuota(8, 2026, 31), trovata: false, nomeTrovato: null, rigaTrovata: null };
    expect(() => validaEstrazione(e, 2026)).toThrow(RigaNonTrovata);
  });
});

describe('vociDaEstrazione', () => {
  it('salta i giorni senza codice: luglio comincia il 17', () => {
    const voci = vociDaEstrazione(validaEstrazione(luglio(), 2026));
    expect(voci).toHaveLength(15);
    expect(voci[0]).toEqual({ date: '2026-07-17', day: 17, code: 'M' });
    expect(voci[14]).toEqual({ date: '2026-07-31', day: 31, code: 'P' });
  });

  it('un mese senza nulla non produce voci', () => {
    expect(vociDaEstrazione(validaEstrazione(vuota(8, 2026, 31), 2026))).toEqual([]);
  });
});

describe('giornoRoma', () => {
  it('e la data italiana, non quella UTC', () => {
    // Mezzanotte e mezza a Roma d'estate: a Greenwich e ancora il giorno prima.
    expect(giornoRoma(new Date('2026-08-02T22:30:00Z'))).toBe('2026-08-03');
    expect(giornoRoma(new Date('2026-08-02T12:00:00Z'))).toBe('2026-08-02');
  });
});
