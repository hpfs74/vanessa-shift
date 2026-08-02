import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Codice, IsoDate, Paga } from '@vanessa/core';
import { CODICI, MESI, PAGA_VUOTA, giorniDelMese } from '@vanessa/core';

import { Calendario } from './Calendario.js';
import { Stipendio } from './Stipendio.js';
import { api as apiReale, type Api } from './api.js';

const ANNO = 2026;

export interface AppProps {
  api?: Api;
  meseIniziale?: number;
}

export function App({ api = apiReale, meseIniziale = 1 }: AppProps) {
  const [mese, setMese] = useState(meseIniziale);
  const [vista, setVista] = useState<'calendario' | 'stipendio'>('calendario');
  const [turni, setTurni] = useState<Map<IsoDate, Codice>>(new Map());
  const [paga, setPaga] = useState<Paga>(PAGA_VUOTA);
  const [selezionato, setSelezionato] = useState<IsoDate | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCaricamento(true);
    Promise.all([api.turni(`${ANNO}-01-01`, `${ANNO}-12-31`), api.paga()])
      .then(([t, p]) => {
        if (!vivo) return;
        setTurni(new Map(t.map((x) => [x.data, x.cod])));
        setPaga(p);
        setErrore(null);
      })
      .catch((e: Error) => vivo && setErrore(e.message))
      .finally(() => vivo && setCaricamento(false));
    return () => {
      vivo = false;
    };
  }, [api]);

  /** Ottimistico: la cella cambia subito, e torna indietro se la rete dice di no. */
  const scegliCodice = useCallback(
    async (d: IsoDate, cod: Codice | null) => {
      const precedente = turni.get(d) ?? null;
      setTurni((m) => {
        const n = new Map(m);
        if (cod) n.set(d, cod);
        else n.delete(d);
        return n;
      });
      setSelezionato(null);
      try {
        await api.salvaTurno(d, cod);
        setErrore(null);
      } catch (e) {
        setTurni((m) => {
          const n = new Map(m);
          if (precedente) n.set(d, precedente);
          else n.delete(d);
          return n;
        });
        setErrore((e as Error).message);
      }
    },
    [api, turni],
  );

  const cambiaPaga = useCallback(
    (p: Paga) => {
      setPaga(p);
      api.salvaPaga(p).catch((e: Error) => setErrore(e.message));
    },
    [api],
  );

  const giorniMese = useMemo(() => giorniDelMese(ANNO, mese), [mese]);

  return (
    <div className="app">
      <header>
        <h1>Turni di Vanessa</h1>
        <nav aria-label="Viste">
          <button
            type="button"
            aria-current={vista === 'calendario'}
            onClick={() => setVista('calendario')}
          >
            Calendario
          </button>
          <button
            type="button"
            aria-current={vista === 'stipendio'}
            onClick={() => setVista('stipendio')}
          >
            Stipendio
          </button>
        </nav>
      </header>

      {errore && (
        <p className="errore" role="alert">
          {errore}
        </p>
      )}

      {vista === 'calendario' && (
        <>
          <div className="navigazione-mese">
            <button
              type="button"
              aria-label="Mese precedente"
              disabled={mese === 1}
              onClick={() => setMese((m) => Math.max(1, m - 1))}
            >
              ‹
            </button>
            <h2>
              {MESI[mese - 1]} {ANNO}
            </h2>
            <button
              type="button"
              aria-label="Mese successivo"
              disabled={mese === 12}
              onClick={() => setMese((m) => Math.min(12, m + 1))}
            >
              ›
            </button>
          </div>

          {caricamento ? (
            <p className="attesa">Carico i turni…</p>
          ) : (
            <Calendario
              anno={ANNO}
              mese={mese}
              turni={turni}
              selezionato={selezionato}
              onScegli={setSelezionato}
            />
          )}
        </>
      )}

      {vista === 'stipendio' && (
        <Stipendio anno={ANNO} turni={turni} paga={paga} onCambiaPaga={cambiaPaga} />
      )}

      {selezionato && (
        <div className="scelta" role="dialog" aria-label={`Turno del ${selezionato}`}>
          <p>{selezionato}</p>
          <div className="codici">
            {CODICI.map((t) => (
              <button
                key={t.cod}
                type="button"
                className={`t-${t.cod}`}
                onClick={() => void scegliCodice(selezionato, t.cod)}
              >
                <strong>{t.cod}</strong>
                <span>{t.descrizione}</span>
              </button>
            ))}
            <button type="button" onClick={() => void scegliCodice(selezionato, null)}>
              <strong>×</strong>
              <span>Cancella</span>
            </button>
          </div>
          <button type="button" className="chiudi" onClick={() => setSelezionato(null)}>
            Chiudi
          </button>
        </div>
      )}

      <footer>
        <small>
          {giorniMese.length} giorni in {MESI[mese - 1]}
        </small>
      </footer>
    </div>
  );
}
