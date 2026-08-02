/** Il calendario mensile: stessa disposizione del foglio, lunedi-domenica. */

import type { Codice, IsoDate } from '@vanessa/core';
import {
  GIORNI_BREVI,
  MESI,
  festiviItaliani,
  giorniDelMese,
  giornoSettimana,
  orario,
  ore,
  oreDelMese,
  tipoGiorno,
} from '@vanessa/core';

export interface CalendarioProps {
  anno: number;
  mese: number;
  turni: ReadonlyMap<IsoDate, Codice>;
  selezionato: IsoDate | null;
  onScegli: (d: IsoDate) => void;
}

/** Le settimane del mese, con `null` nelle caselle dei mesi vicini. */
export function settimaneDelMese(anno: number, mese: number): (IsoDate | null)[][] {
  const giorni = giorniDelMese(anno, mese);
  const primo = giorni[0]!;
  const celle: (IsoDate | null)[] = Array<IsoDate | null>(giornoSettimana(primo)).fill(null);
  celle.push(...giorni);
  while (celle.length % 7 !== 0) celle.push(null);
  const settimane: (IsoDate | null)[][] = [];
  for (let i = 0; i < celle.length; i += 7) settimane.push(celle.slice(i, i + 7));
  return settimane;
}

export function oreSettimana(
  settimana: readonly (IsoDate | null)[],
  turni: ReadonlyMap<IsoDate, Codice>,
): number {
  return settimana.reduce<number>((acc, d) => acc + (d ? ore(turni.get(d)) : 0), 0);
}

export function Calendario({ anno, mese, turni, selezionato, onScegli }: CalendarioProps) {
  const festivi = festiviItaliani(anno);
  const settimane = settimaneDelMese(anno, mese);
  const totali = oreDelMese(anno, mese, turni);

  return (
    <section className="calendario" aria-label={`${MESI[mese - 1]} ${anno}`}>
      <div className="griglia intestazione" role="row">
        {GIORNI_BREVI.map((g) => (
          <div key={g} className="cella-intestazione" role="columnheader">
            {g}
          </div>
        ))}
        <div className="cella-intestazione ore" role="columnheader">
          Ore
        </div>
      </div>

      {settimane.map((settimana, i) => (
        <div className="griglia" role="row" key={i}>
          {settimana.map((d, j) => {
            if (!d) return <div key={j} className="giorno vuoto" aria-hidden="true" />;
            const cod = turni.get(d);
            const tipo = tipoGiorno(d, festivi);
            const numero = Number(d.slice(8));
            const nomeFestivo = festivi.get(d);
            return (
              <button
                key={j}
                type="button"
                className={[
                  'giorno',
                  `g-${tipo}`,
                  cod ? `t-${cod}` : '',
                  selezionato === d ? 'selezionato' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-pressed={selezionato === d}
                aria-label={
                  `${numero} ${MESI[mese - 1]}` +
                  (nomeFestivo ? `, ${nomeFestivo}` : '') +
                  (cod ? `, turno ${cod}` : ', nessun turno')
                }
                onClick={() => onScegli(d)}
              >
                <span className="numero">{numero}</span>
                <span className="codice">{cod ?? ''}</span>
                <span className="orario">{cod ? orario(cod) : ''}</span>
              </button>
            );
          })}
          <div className="giorno ore-settimana">
            {oreSettimana(settimana, turni) || ''}
          </div>
        </div>
      ))}

      <p className="totale-mese">
        <strong>{totali.totale}</strong> ore ·{' '}
        {[...turni.entries()].filter(([d, c]) => d.startsWith(`${anno}-${String(mese).padStart(2, '0')}`) && ore(c) > 0).length}{' '}
        giorni lavorati
      </p>
    </section>
  );
}
