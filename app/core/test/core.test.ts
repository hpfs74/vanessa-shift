import { describe, expect, it } from 'vitest';

import {
  type Codice,
  type IsoDate,
  CODICI,
  PAGA_VUOTA,
  differenzaGiorni,
  festiviItaliani,
  giorniDellAnno,
  giorniDelMese,
  giornoSettimana,
  importiDelMese,
  isCodice,
  isIsoDate,
  ore,
  orario,
  oreDelMese,
  pasqua,
  sommaImporti,
  tipoGiorno,
} from '../src/index.js';

describe('codici turno', () => {
  it('il pomeriggio dura sette ore e il pomeriggio lungo otto', () => {
    expect(ore('P')).toBe(7);
    expect(ore('P1')).toBe(8);
    expect(orario('P')).toBe('13:00-20:00');
    expect(orario('P1')).toBe('13:00-21:00');
  });

  it('mattina, mattina lunga e libero', () => {
    expect(ore('M')).toBe(6);
    expect(ore('M1')).toBe(7);
    expect(ore('L')).toBe(0);
    expect(orario('L')).toBe('–');
  });

  it("un giorno senza codice non contribuisce ore", () => {
    expect(ore(undefined)).toBe(0);
    expect(ore(null)).toBe(0);
  });

  it('riconosce solo i codici previsti', () => {
    for (const t of CODICI) expect(isCodice(t.cod)).toBe(true);
    for (const v of ['X', 'm', '', 'P2', 7, null, undefined]) {
      expect(isCodice(v)).toBe(false);
    }
  });
});

describe('date', () => {
  it('accetta solo date ISO realmente esistenti', () => {
    expect(isIsoDate('2026-01-15')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-11-31')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-00-10')).toBe(false);
    expect(isIsoDate('15/01/2026')).toBe(false);
    expect(isIsoDate('2026-1-5')).toBe(false);
    expect(isIsoDate(20260115)).toBe(false);
  });

  it('il primo gennaio 2026 e giovedi, la settimana parte da lunedi', () => {
    expect(giornoSettimana('2026-01-01')).toBe(3);
    expect(giornoSettimana('2026-01-05')).toBe(0);
    expect(giornoSettimana('2026-04-25')).toBe(5);
    expect(giornoSettimana('2026-11-01')).toBe(6);
  });

  it('conta i giorni di ogni mese, bisestili compresi', () => {
    expect(giorniDelMese(2026, 2)).toHaveLength(28);
    expect(giorniDelMese(2024, 2)).toHaveLength(29);
    expect(giorniDellAnno(2026)).toHaveLength(365);
    expect(giorniDellAnno(2024)).toHaveLength(366);
  });

  it('non si sposta di un giorno attraverso il cambio dora', () => {
    // L'ora legale in Italia scatta l'ultima domenica di marzo.
    expect(differenzaGiorni('2026-03-28', '2026-03-30')).toBe(2);
    expect(differenzaGiorni('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('festivi', () => {
  it('calcola la Pasqua', () => {
    expect(pasqua(2026)).toBe('2026-04-05');
    expect(pasqua(2024)).toBe('2024-03-31');
    expect(pasqua(2011)).toBe('2011-04-24');
    expect(pasqua(2027)).toBe('2027-03-28');
    expect(pasqua(2038)).toBe('2038-04-25');
    expect(pasqua(2000)).toBe('2000-04-23');
  });

  it('il 2026 ha undici festivi nazionali', () => {
    const f = festiviItaliani(2026);
    expect(f.size).toBe(11);
    expect(f.get('2026-04-06')).toBe("Lunedi dell'Angelo");
    expect(f.get('2026-12-26')).toBe('Santo Stefano');
  });

  it('quando la Pasquetta cade il 25 aprile non si conta due volte', () => {
    const f = festiviItaliani(2011);
    expect(f.size).toBe(10);
    expect(f.get('2011-04-25')).toBe('Liberazione');
  });

  it('festivo batte domenica, domenica batte sabato', () => {
    const f = festiviItaliani(2026);
    expect(tipoGiorno('2026-04-25', f)).toBe('festivo'); // sabato festivo
    expect(tipoGiorno('2026-11-01', f)).toBe('festivo'); // domenica festiva
    expect(tipoGiorno('2026-04-26', f)).toBe('domenica');
    expect(tipoGiorno('2026-04-18', f)).toBe('sabato');
    expect(tipoGiorno('2026-04-24', f)).toBe('feriale');
  });
});

/** Assegna un codice a ogni giorno dell'anno, ciclando fra quelli lavorati. */
function annoPieno(anno: number): Map<IsoDate, Codice> {
  const lavorati: Codice[] = ['M', 'M1', 'P', 'P1'];
  const turni = new Map<IsoDate, Codice>();
  giorniDellAnno(anno).forEach((d, i) => turni.set(d, lavorati[i % lavorati.length]));
  return turni;
}

describe('ripartizione delle ore', () => {
  it('ogni ora finisce in esattamente una categoria, tutti i mesi', () => {
    const turni = annoPieno(2026);
    const festivi = festiviItaliani(2026);

    for (let mese = 1; mese <= 12; mese++) {
      const o = oreDelMese(2026, mese, turni);
      expect(o.ordinarie + o.sabato + o.domenica + o.festivo).toBe(o.totale);

      // Confronto contro un oracolo indipendente, giorno per giorno.
      const atteso = { feriale: 0, sabato: 0, domenica: 0, festivo: 0 };
      for (const d of giorniDelMese(2026, mese)) {
        atteso[tipoGiorno(d, festivi)] += ore(turni.get(d));
      }
      expect(o.ordinarie).toBe(atteso.feriale);
      expect(o.sabato).toBe(atteso.sabato);
      expect(o.domenica).toBe(atteso.domenica);
      expect(o.festivo).toBe(atteso.festivo);
    }
  });

  it('la somma dei dodici mesi copre tutte le ore dellanno', () => {
    const turni = annoPieno(2026);
    let somma = 0;
    for (let mese = 1; mese <= 12; mese++) somma += oreDelMese(2026, mese, turni).totale;
    const tutte = giorniDellAnno(2026).reduce((acc, d) => acc + ore(turni.get(d)), 0);
    expect(somma).toBe(tutte);
  });

  it('un festivo di sabato conta come festivo e non come sabato', () => {
    // 25 aprile 2026 e' sabato ed e' festivo.
    const turni = new Map<IsoDate, Codice>([['2026-04-25', 'P1']]);
    const o = oreDelMese(2026, 4, turni);
    expect(o.festivo).toBe(8);
    expect(o.sabato).toBe(0);
    expect(o.totale).toBe(8);
  });

  it('un festivo di domenica conta come festivo e non come domenica', () => {
    // 1 novembre 2026 e' domenica ed e' festivo.
    const turni = new Map<IsoDate, Codice>([['2026-11-01', 'M']]);
    const o = oreDelMese(2026, 11, turni);
    expect(o.festivo).toBe(6);
    expect(o.domenica).toBe(0);
  });

  it('i giorni liberi e i giorni non inseriti non contano', () => {
    const turni = new Map<IsoDate, Codice>([['2026-01-05', 'L']]);
    expect(oreDelMese(2026, 1, turni).totale).toBe(0);
    expect(oreDelMese(2026, 1, new Map()).totale).toBe(0);
  });

  it('funziona anche su un anno bisestile', () => {
    const turni = annoPieno(2024);
    const o = oreDelMese(2024, 2, turni);
    expect(o.ordinarie + o.sabato + o.domenica + o.festivo).toBe(o.totale);
    expect(giorniDelMese(2024, 2)).toHaveLength(29);
  });
});

describe('importi', () => {
  const ORE: ReturnType<typeof oreDelMese> = {
    ordinarie: 100,
    sabato: 8,
    domenica: 4,
    festivo: 2,
    totale: 114,
  };

  it('senza tariffa non compare nessuna cifra', () => {
    const i = importiDelMese(ORE, PAGA_VUOTA);
    expect(i.lordoBase).toBeNull();
    expect(i.lordoTotale).toBeNull();
    expect(i.nettoStimato).toBeNull();
    expect(i.rateo13a).toBeNull();
  });

  it('calcola base, maggiorazioni, rateo e netto', () => {
    const i = importiDelMese(ORE, {
      tariffaOraria: 10,
      maggSabato: 0.2,
      maggDomenica: 0.3,
      maggFestivo: 0.5,
      rateo13a: 1 / 12,
      coeffNetto: 0.75,
    });
    expect(i.lordoBase).toBe(1140);
    expect(i.maggSabato).toBeCloseTo(16, 10);
    expect(i.maggDomenica).toBeCloseTo(12, 10);
    expect(i.maggFestivo).toBeCloseTo(10, 10);
    const imponibile = 1140 + 16 + 12 + 10;
    expect(i.rateo13a).toBeCloseTo(imponibile / 12, 10);
    expect(i.lordoTotale).toBeCloseTo(imponibile + imponibile / 12, 10);
    expect(i.nettoStimato).toBeCloseTo((imponibile + imponibile / 12) * 0.75, 10);
  });

  it('con la sola tariffa mostra il lordo base ma non il totale', () => {
    // Un totale che ignora le maggiorazioni sottostima quanto spetta:
    // meglio niente che una cifra sbagliata per difetto.
    const i = importiDelMese(ORE, { ...PAGA_VUOTA, tariffaOraria: 10 });
    expect(i.lordoBase).toBe(1140);
    expect(i.maggSabato).toBeNull();
    expect(i.maggDomenica).toBeNull();
    expect(i.maggFestivo).toBeNull();
    expect(i.lordoTotale).toBeNull();
    expect(i.rateo13a).toBeNull();
    expect(i.nettoStimato).toBeNull();
  });

  it('basta una maggiorazione mancante per non mostrare il totale', () => {
    const quasi = {
      ...PAGA_VUOTA,
      tariffaOraria: 10,
      maggSabato: 0.2,
      maggDomenica: 0.3,
      coeffNetto: 0.7,
    };
    const i = importiDelMese(ORE, quasi);
    expect(i.maggSabato).toBeCloseTo(16, 10);
    expect(i.maggFestivo).toBeNull();
    expect(i.lordoTotale).toBeNull();
    expect(i.nettoStimato).toBeNull();
  });

  it('il netto richiede anche il coefficiente', () => {
    const completa = {
      tariffaOraria: 10,
      maggSabato: 0.2,
      maggDomenica: 0.3,
      maggFestivo: 0.5,
      rateo13a: 1 / 12,
      coeffNetto: null,
    };
    expect(importiDelMese(ORE, completa).lordoTotale).not.toBeNull();
    expect(importiDelMese(ORE, completa).nettoStimato).toBeNull();
    const con = importiDelMese(ORE, { ...completa, coeffNetto: 0.7 });
    const imponibile = 1140 + 16 + 12 + 10;
    expect(con.nettoStimato).toBeCloseTo((imponibile + imponibile / 12) * 0.7, 10);
  });

  it('il totale annuo resta vuoto se ogni mese e vuoto', () => {
    const vuoti = Array.from({ length: 12 }, () => importiDelMese(ORE, PAGA_VUOTA));
    const t = sommaImporti(vuoti);
    expect(t.lordoTotale).toBeNull();
    expect(t.nettoStimato).toBeNull();
  });

  it('il totale annuo somma i mesi configurati', () => {
    const paga = { ...PAGA_VUOTA, tariffaOraria: 10, coeffNetto: 0.5 };
    const mesi = Array.from({ length: 12 }, () => importiDelMese(ORE, paga));
    const t = sommaImporti(mesi);
    expect(t.lordoBase).toBeCloseTo(1140 * 12, 8);
    expect(t.nettoStimato).toBeCloseTo(mesi[0].nettoStimato! * 12, 8);
  });
});
