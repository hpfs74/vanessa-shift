/** Settings and simulation. No figure appears until it is true.
 *
 * All visible text stays in Italian: Vanessa reads it.
 */

import type { IsoDate, PaySettings, ShiftCode } from '@vanessa/core';
import { MONTH_NAMES, monthHours, monthPay, sumPay } from '@vanessa/core';

export interface PayProps {
  year: number;
  shifts: ReadonlyMap<IsoDate, ShiftCode>;
  settings: PaySettings;
  onChange: (p: PaySettings) => void;
}

const euro = (v: number | null): string =>
  v == null
    ? '–'
    : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(v);

const FIELDS: { key: keyof PaySettings; label: string; isPercentage: boolean }[] = [
  { key: 'hourlyRate', label: 'Tariffa oraria lorda (€)', isPercentage: false },
  { key: 'saturdayPremium', label: 'Maggiorazione sabato (%)', isPercentage: true },
  { key: 'sundayPremium', label: 'Maggiorazione domenica (%)', isPercentage: true },
  { key: 'holidayPremium', label: 'Maggiorazione festivo (%)', isPercentage: true },
  { key: 'thirteenthAccrual', label: 'Rateo 13a (%)', isPercentage: true },
  { key: 'netRatio', label: 'Coefficiente netto/lordo (%)', isPercentage: true },
];

export function Pay({ year, shifts, settings, onChange }: PayProps) {
  const months = MONTH_NAMES.map((_, i) => {
    const h = monthHours(year, i + 1, shifts);
    return { hours: h, pay: monthPay(h, settings) };
  });
  const total = sumPay(months.map((m) => m.pay));
  const yearHours = months.reduce((a, m) => a + m.hours.total, 0);

  const write = (key: keyof PaySettings, text: string, isPercentage: boolean) => {
    if (text.trim() === '') return onChange({ ...settings, [key]: null });
    const n = Number(text.replace(',', '.'));
    if (!Number.isFinite(n)) return;
    onChange({ ...settings, [key]: isPercentage ? n / 100 : n });
  };

  const show = (v: number | null, isPercentage: boolean): string =>
    v == null ? '' : isPercentage ? String(Math.round(v * 10000) / 100) : String(v);

  return (
    <section className="pay">
      <h2>Parametri</h2>
      <p className="note">
        La tariffa oraria si legge sul contratto o sulla busta paga (CCNL Cooperative
        Sociali, OSS livello C1). Il coefficiente netto/lordo si ottiene dividendo il netto
        di una busta paga vera per il suo lordo.
      </p>

      <div className="settings">
        {FIELDS.map(({ key, label, isPercentage }) => (
          <label key={key}>
            <span>{label}</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={show(settings[key], isPercentage)}
              placeholder="–"
              onChange={(e) => write(key, e.target.value, isPercentage)}
            />
          </label>
        ))}
      </div>

      <h2>Simulazione {year}</h2>
      <div className="scroll-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Mese</th>
              <th scope="col">Ord.</th>
              <th scope="col">Sab</th>
              <th scope="col">Dom</th>
              <th scope="col">Fest</th>
              <th scope="col">Base</th>
              <th scope="col">Lordo</th>
              <th scope="col">Netto stimato</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m, i) => (
              <tr key={MONTH_NAMES[i]}>
                <th scope="row">{MONTH_NAMES[i]}</th>
                <td>{m.hours.ordinary || ''}</td>
                <td>{m.hours.saturday || ''}</td>
                <td>{m.hours.sunday || ''}</td>
                <td>{m.hours.holiday || ''}</td>
                <td>{euro(m.pay.basePay)}</td>
                <td>{euro(m.pay.grossTotal)}</td>
                <td>{euro(m.pay.estimatedNet)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Totale</th>
              <td colSpan={4}>{yearHours} ore</td>
              <td>{euro(total.basePay)}</td>
              <td>{euro(total.grossTotal)}</td>
              <td>{euro(total.estimatedNet)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="note">
        <strong>Base</strong> è la retribuzione sulle ore lavorate; <strong>Lordo</strong>{' '}
        aggiunge maggiorazioni e rateo, e compare solo quando tutte le percentuali sono
        impostate: un totale che ne ignora una sottostimerebbe quanto ti spetta.
      </p>
      <p className="note">
        Non calcola: straordinari, lavoro notturno, scatti di anzianità, TFR, conguagli,
        addizionali regionali e comunali. È una stima di ciò che ci si può aspettare, non
        una busta paga.
      </p>
    </section>
  );
}
