/** Parametri e simulazione. Nessuna cifra compare finche' non e' vera. */

import type { Codice, IsoDate, Paga } from '@vanessa/core';
import { MESI, importiDelMese, oreDelMese, sommaImporti } from '@vanessa/core';

export interface StipendioProps {
  anno: number;
  turni: ReadonlyMap<IsoDate, Codice>;
  paga: Paga;
  onCambiaPaga: (p: Paga) => void;
}

const euro = (v: number | null): string =>
  v == null
    ? '–'
    : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(v);

const PARAMETRI: { chiave: keyof Paga; etichetta: string; percentuale: boolean }[] = [
  { chiave: 'tariffaOraria', etichetta: 'Tariffa oraria lorda (€)', percentuale: false },
  { chiave: 'maggSabato', etichetta: 'Maggiorazione sabato (%)', percentuale: true },
  { chiave: 'maggDomenica', etichetta: 'Maggiorazione domenica (%)', percentuale: true },
  { chiave: 'maggFestivo', etichetta: 'Maggiorazione festivo (%)', percentuale: true },
  { chiave: 'rateo13a', etichetta: 'Rateo 13a (%)', percentuale: true },
  { chiave: 'coeffNetto', etichetta: 'Coefficiente netto/lordo (%)', percentuale: true },
];

export function Stipendio({ anno, turni, paga, onCambiaPaga }: StipendioProps) {
  const mesi = MESI.map((_, i) => {
    const o = oreDelMese(anno, i + 1, turni);
    return { ore: o, importi: importiDelMese(o, paga) };
  });
  const totale = sommaImporti(mesi.map((m) => m.importi));
  const oreAnno = mesi.reduce((a, m) => a + m.ore.totale, 0);

  const scrivi = (chiave: keyof Paga, testo: string, percentuale: boolean) => {
    if (testo.trim() === '') return onCambiaPaga({ ...paga, [chiave]: null });
    const n = Number(testo.replace(',', '.'));
    if (!Number.isFinite(n)) return;
    onCambiaPaga({ ...paga, [chiave]: percentuale ? n / 100 : n });
  };

  const mostra = (v: number | null, percentuale: boolean): string =>
    v == null ? '' : percentuale ? String(Math.round(v * 10000) / 100) : String(v);

  return (
    <section className="stipendio">
      <h2>Parametri</h2>
      <p className="nota">
        La tariffa oraria si legge sul contratto o sulla busta paga (CCNL Cooperative
        Sociali, OSS livello C1). Il coefficiente netto/lordo si ottiene dividendo il netto
        di una busta paga vera per il suo lordo.
      </p>

      <div className="parametri">
        {PARAMETRI.map(({ chiave, etichetta, percentuale }) => (
          <label key={chiave}>
            <span>{etichetta}</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={mostra(paga[chiave], percentuale)}
              placeholder="–"
              onChange={(e) => scrivi(chiave, e.target.value, percentuale)}
            />
          </label>
        ))}
      </div>

      <h2>Simulazione {anno}</h2>
      <div className="tabella-scorrevole">
        <table>
          <thead>
            <tr>
              <th scope="col">Mese</th>
              <th scope="col">Ord.</th>
              <th scope="col">Sab</th>
              <th scope="col">Dom</th>
              <th scope="col">Fest</th>
              <th scope="col">Lordo</th>
              <th scope="col">Netto stimato</th>
            </tr>
          </thead>
          <tbody>
            {mesi.map((m, i) => (
              <tr key={MESI[i]}>
                <th scope="row">{MESI[i]}</th>
                <td>{m.ore.ordinarie || ''}</td>
                <td>{m.ore.sabato || ''}</td>
                <td>{m.ore.domenica || ''}</td>
                <td>{m.ore.festivo || ''}</td>
                <td>{euro(m.importi.lordoTotale)}</td>
                <td>{euro(m.importi.nettoStimato)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Totale</th>
              <td colSpan={4}>{oreAnno} ore</td>
              <td>{euro(totale.lordoTotale)}</td>
              <td>{euro(totale.nettoStimato)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="nota">
        Non calcola: straordinari, lavoro notturno, scatti di anzianità, TFR, conguagli,
        addizionali regionali e comunali. È una stima di ciò che ci si può aspettare, non
        una busta paga.
      </p>
    </section>
  );
}
